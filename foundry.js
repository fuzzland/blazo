const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

async function forge_build_json(project_dir) {
    let task_dir = path.join(project_dir, `build-info-${uuidv4()}`);
    let cmd = `forge build --build-info --build-info-path ${task_dir} --force --optimizer-runs 1000`;
    let promise = new Promise((resolve, reject) => {
        try {
            console.log("Running forge build", cmd);
            let process = exec(`cd ${project_dir} && ` + cmd);
            process.stdout.on('data', (data) => {
                console.info(data.toString());
            });

            process.stderr.on('data', (data) => {
                console.log(data.toString());
            });

            process.on('exit', (code) => {
                if (!fs.existsSync(task_dir)) {
                    resolve({
                        success: false,
                        err: "Build info not found"
                    });
                    return;
                }
                let files = fs.readdirSync(task_dir);
                let contents = [];
                for (let file of files) {
                    if (!file.endsWith('.json')) {
                        continue;
                    }
                    let fp = path.join(task_dir, file);
                    let content = fs.readFileSync(fp, 'utf8');
                    content = JSON.parse(content);
                    contents.push(content);
                }
                resolve({
                    success: true,
                    contents
                });
            });
        } catch (err) {
            resolve({
                success: false,
                err: err.stderr.toString()
            });
        }
    });

    return await promise;
}

module.exports = { forge_build_json };