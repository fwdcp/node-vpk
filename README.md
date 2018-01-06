# node-vpk
extractor and creator for the Valve Pack Format

### Prerequisites

Requires fs-extra, jBinary and crc,
but npm will install them automatically if you follow my instructions

### Installing
globally
```
npm install -g vpk
```
or locally
```
npm install vpk
```
(Those will also install dependencies, no need to worry about them)
### How to use

To extract a V1/V2 VPK:
```
const {VPK} = require("node-vpk");

// load a vpk (V1/V2) (ALWAYS select the _dir file)
var my_vpk = new VPK("C:/Programs("C:/Program Files (x86)/Steam/steamapps/common/dota 2 beta/game/dota/pak01_dir");
my_vpk.load();

// extract it
my_vpk.extract("C:/Users/Public/Desktop/pak01_dir");
```

To create a V1 vpk (V2 coming soon):
```
const {VPKcreator} = require("node-vpk");

// load a directory
var my_vpk = new VPKcreator("C:/Users/Public/Desktop/pak01_dir");
my_vpk.load();

// save it as .vpk
my_vpk.save("C:/Users/Public/Desktop/my_created_vpk.vpk");
```
	
