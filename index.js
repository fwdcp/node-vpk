"use strict";

var crc = require('crc');
var fs = require('fs/promises');
var jBinary = require('jbinary');
var path = require('path');

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
                crc: 'uint32',
                preloadBytes: 'uint16',
                archiveIndex: 'uint16',
                entryOffset: 'uint32',
                entryLength: 'uint32'
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

let HEADER_1_LENGTH = 12;
let HEADER_2_LENGTH = 28;

let MAX_PATH = 260;

class VPK {
    constructor(path) {
        this.directoryPath = path;
    }

    async isValid() {
        let header = Buffer.alloc(HEADER_2_LENGTH);
        const directoryPathHandle = await fs.open(this.directoryPath);
        await directoryPathHandle.read(header, 0, HEADER_2_LENGTH, 0);
        await directoryPathHandle.close();
        let binary = new jBinary(header, TYPESET);

        try {
            binary.read('vpkHeader');
            return true;
        }
        catch (e) {
            return false;
        }
    }

    async load() {
        const directoryFileBuffer = await fs.readFile(this.directoryPath);
        let binary = new jBinary(directoryFileBuffer, TYPESET);

        this.header = binary.read('vpkHeader');
        this.tree = binary.read('vpkTree');
    }

    get files() {
        return Object.keys(this.tree);
    }

    async getFile(path) {
        let entry = this.tree[path];

        if (!entry) {
            return null;
        }

        let file = Buffer.alloc(entry.preloadBytes + entry.entryLength);
        const directoryPathHandle = await fs.open(this.directoryPath);

        if (entry.preloadBytes > 0) {
            await directoryPathHandle.read(file, 0, entry.preloadBytes, entry.preloadOffset);
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

                await directoryPathHandle.read(file, entry.preloadBytes, entry.entryLength, (offset + entry.entryOffset));
            }
            else {
                let fileIndex = ('000' + entry.archiveIndex).slice(-3);
                let archivePath = this.directoryPath.replace(/_dir\.vpk$/, '_' + fileIndex + '.vpk');

                const archivePathHandle = await fs.open(archivePath);
                await archivePathHandle.read(file, entry.preloadBytes, entry.entryLength, entry.entryOffset);
                await archivePathHandle.close();
            }
        }

        await directoryPathHandle.close();

        if (crc.crc32(file) !== entry.crc) {
            throw new Error('CRC does not match');
        }

        return file;
    }
}

module.exports = VPK;
