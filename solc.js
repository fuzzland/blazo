const MemoryStream = require('memorystream');
const https = require('https');
const Module = module.constructor;

const wrapper = require('solc/wrapper');
const fs = require('fs');
const path = require('path');

function loadRemoteVersion (versionString, callback) {
    const memoryStream = new MemoryStream(null, { readable: false });
    const url = `https://binaries.soliditylang.org/bin/soljson-${versionString}.js`;

    let cacheKey = `solc-${versionString}`;
    let cachePath = path.join(__dirname, '..', '.cache', cacheKey);
    if (fs.existsSync(cachePath)) {
        process.stderr.write(`Loading solc from cache: ${cachePath}\n`);
        const soljson = new Module();
        let content = fs.readFileSync(cachePath, 'utf8');
        soljson._compile(content, `soljson-${versionString}.js`);
        if (module.parent && module.parent.children) {
            // Make sure the module is plugged into the hierarchy correctly to have parent
            // properly garbage collected.
            module.parent.children.splice(module.parent.children.indexOf(soljson), 1);
        }
        return callback(null, wrapper(soljson.exports));
    } else {
        process.stderr.write(`Downloading solc from ${url}\n`);
        // create directory if it doesn't exist
        let cacheDir = path.dirname(cachePath);
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir);
        }
    }

    https.get(url, response => {
        if (response.statusCode !== 200) {
            callback(new Error(`Error retrieving binary: ${response.statusMessage}`));
        } else {
            response.pipe(memoryStream);
            response.on('end', () => {
                // Based on the require-from-string package.
                const soljson = new Module();
                let content = memoryStream.toString();
                soljson._compile(content, `soljson-${versionString}.js`);

                fs.writeFileSync(cachePath, content, 'utf8');

                if (module.parent && module.parent.children) {
                    // Make sure the module is plugged into the hierarchy correctly to have parent
                    // properly garbage collected.
                    module.parent.children.splice(module.parent.children.indexOf(soljson), 1);
                }

                callback(null, wrapper(soljson.exports));
            });
        }
    }).on('error', function (error) {
        callback(error);
    });
}


module.exports = {
    loadRemoteVersion
};