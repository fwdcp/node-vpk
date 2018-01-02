'use strict';

var crc = require('crc');
var fs = require('fs-extra');
var jBinary = require('jbinary');

let TYPESET = {
	'jBinary.littleEndian': true,
	
    vpkHeader: jBinary.Type({
        read: function() {
            let header = {};

            let signature = this.binary.read('uint32');
            if (signature !== 0x55aa1234) {
                throw new Error('VPK signature is invalid');
            }

            header.version = this.binary.read('uint32');
            if (header.version !== 1 && header.version !== 2) {
                throw new Error('VPK version is invalid');
            }

            header.treeLength = this.binary.read('uint32');

            if (header.version === 2) {
                header.unknown1 = this.binary.read('uint32');
                header.footerLength = this.binary.read('uint32');
                header.unknown3 = this.binary.read('uint32');
                header.unknown4 = this.binary.read('uint32');
            }

            return header;
        }
	}),
	
    vpkDirectoryEntry: jBinary.Type({
        read: function() {
            let entry = this.binary.read({
                crc: 'uint32',				// crc integrity
				preloadBytes: 'uint16',		// size of preload (almost always 0) (used for small but critical files)
				archiveIndex: 'uint16',		// on which archive the data is stored (7fff means on _dir archive)
				entryOffset: 'uint32',		// if on _dir, this is offset of data from dirEntry end. If on other archive, offset from start of it
				entryLength: 'uint32'		// size of data
            });

            let terminator = this.binary.read('uint16');
            if (terminator !== 0xffff) {
                throw new Error('directory terminator is invalid');
            }

            return entry;
        }
	}),
	
    vpkTree: jBinary.Type({
        read: function() {
            let files = {};

            while (true) {
                let extension = this.binary.read('string0');

                if (extension === '') {
                    break;
                }

                while (true) {
                    let directory = this.binary.read('string0');

                    if (directory === '') {
                        break;
                    }

                    while (true) {
                        let filename = this.binary.read('string0');

                        if (filename === '') {
                            break;
                        }

                        let fullPath = filename;
                        if (fullPath === ' ') {
                            fullPath = '';
                        }
                        if (extension !== ' ') {
                            fullPath += '.' + extension;
                        }
                        if (directory !== ' ') {
                            fullPath = directory + '/' + fullPath;
                        }

                        let entry = this.binary.read('vpkDirectoryEntry');
                        entry.preloadOffset = this.binary.tell();

                        this.binary.skip(entry.preloadBytes);

                        files[fullPath] = entry;
                    }
                }
            }

            return files;
        }
    })
};

// header size in bytes
let HEADER_1_LENGTH = 12;
let HEADER_2_LENGTH = 28;

// let MAX_PATH = 260;

class VPK {
    constructor(path) {
		this.directoryPath = path;
		this.loaded = false;
    }

    isValid() {
        let header = new Buffer(HEADER_2_LENGTH);
        let directoryFile = fs.openSync(this.directoryPath, 'r');
        fs.readSync(directoryFile, header, 0, HEADER_2_LENGTH, 0);
        let binary = new jBinary(header, TYPESET);

        try {
            binary.read('vpkHeader');

            return true;
        }
        catch (error) {
            return false;
        }
    }

    load() {
        let binary = new jBinary(fs.readFileSync(this.directoryPath), TYPESET);

		try{
        	this.header = binary.read('vpkHeader');
			this.tree = binary.read('vpkTree');
			this.loaded = true;
		} catch(error) {
			throw new Error('Failed loading ' + this.directoryPath);
		}
    }

    get files() {
        return Object.keys(this.tree);
    }

    getFile(path) {
        let entry = this.tree[path];

        if (!entry) {
            return null;
        }

        let file = new Buffer(entry.preloadBytes + entry.entryLength);

        if (entry.preloadBytes > 0) {
            let directoryFile = fs.openSync(this.directoryPath, 'r');
            fs.readSync(directoryFile, file, 0, entry.preloadBytes, entry.preloadOffset);
        }

        if (entry.entryLength > 0) {
            if (entry.archiveIndex === 0x7fff) {
                let offset = this.header.treeLength;

                if (this.header.version === 1) {
                    offset += HEADER_1_LENGTH;
                }
                else if (this.header.version === 2) {
                    offset += HEADER_2_LENGTH;
                }

                let directoryFile = fs.openSync(this.directoryPath, 'r');
                fs.readSync(directoryFile, file, entry.preloadBytes, entry.entryLength, offset + entry.entryOffset);
            }
            else {
				// read from specified archive
                let fileIndex = ('000' + entry.archiveIndex).slice(-3);
                let archivePath = this.directoryPath.replace(/_dir\.vpk$/, '_' + fileIndex + '.vpk');

                let archiveFile = fs.openSync(archivePath, 'r');
                fs.readSync(archiveFile, file, entry.preloadBytes, entry.entryLength, entry.entryOffset);
            }
        }

        if (crc.crc32(file) !== entry.crc) {
            throw new Error('CRC does not match');
        }

        return file;
	}
	
	extract(destinationDir) {
		// if not loaded yet, load it
		if(this.loaded === false){
			try {
				this.load();
			} catch (error) {
				throw new Error('VPK was not loaded and it failed loading');
			}
		}

		var failed = [];
		// make sure destinationDir exists
		try {
			fs.ensureDirSync(destinationDir);
		} catch (error) {
			throw new Error('Destination dir cant be ensured');
		}

		// extract files one by one
		for (var file of this.files) {
			// destination of this file (with file name and extension)
			var destFile = destinationDir + '/' + file;
			// destination of this file (only the directory)
			var fileDestDir = destFile.substr(0, destFile.lastIndexOf('/'));

			// make sure destination dir of this file exists
			try {
				fs.ensureDirSync(fileDestDir);
			} catch (error) {
				throw new Error('Error ensuring file directory: ' + fileDestDir);
			}

			// get the file
			try {
				var fileBuffer = this.getFile(file);
			} catch (error) {
				throw error;
			}

			// write it
			try {
				fs.writeFileSync(destFile, fileBuffer);
			} catch (error) {
				failed.push(destFile);
			}
		}

		// throw all failed files
		if (failed.length !== 0) {
			throw new Error('Failed extrating following files: \r\n' + failed.toString());
		}
	}
}

module.exports = VPK;
