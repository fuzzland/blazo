const fs = require('fs');
const process = require('process');
const { loadRemoteVersion } = require('./solc');

const [,,compilerVersion, filename] = process.argv;


loadRemoteVersion(compilerVersion, (err, solcSnapshot) => {
    if (err) {
        process.stderr.write(err);
        process.exit(1);
    }
    let content = fs.readFileSync(filename, 'utf8');

    fs.writeFileSync(filename, solcSnapshot.compile(content));
    // process.stdout.write(solcSnapshot.compile(content))
    process.exit(0);
 });
