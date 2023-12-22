const fs = require('fs');
const path = require('path');
const { table } = require('table');

const dir = process.cwd();

function divideCalculate(numerator, denominator) {
    if (denominator === 0 || isNaN(denominator)) {
        return 0;
    } else {
        return (numerator / denominator) * 100;
    }
}

function calculatePercentage(numerator, denominator, digits = 2, percentsign = true) {
    const result = divideCalculate(numerator, denominator);
    return percentsign ? result.toFixed(digits) + '%' : result.toFixed(digits);
}

function getTransformedContractFiles(contractFiles) {
    const results = Object.entries(contractFiles).map(([address, contents]) =>
        contents.reduce((result, value) => {
            if (value.length > 0) {
                const [filename, code] = value;
                result[`${address}__${filename}`] = code;
            }
            return result;
        }, {})
    );
    return Object.assign({}, ...results);
}

function getTransformedCoverageJson(coverageJson, transformedContractFiles) {
    const results = {};
    if (!coverageJson.coverage) return results;
    for (const [key, value] of Object.entries(coverageJson.coverage)) {
        for (const item of value.covered_code) {
            const contractAddress = key.match(/0x([a-fA-F0-9]+)/)?.[0];
            const combinedKey = `${contractAddress}__${item.file}`;
            const code = transformedContractFiles[combinedKey];

            if (!code) continue;

            if (!results.hasOwnProperty(combinedKey)) {
                results[combinedKey] = [];
            }

            const word = code.slice(item.offset, item.offset + item.length);
            results[combinedKey].push({ ...item, word });
        }
    }
    return results;
}

function getHighlightLineCount(arr, code) {
    let lineWords = {};
    for (let item of arr) {
        let lineNumber = (code.substring(0, item.offset + item.length).match(/\n/g) || []).length + 1;

        if (!lineWords[lineNumber]) {
            lineWords[lineNumber] = [];
        }

        lineWords[lineNumber].push(item.word);
    }

    return Object.keys(lineWords).length;
}

function generateHTML(table) {
    return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Contract coverage</title>
    <style>
      table {
        width: 100%;
        border-collapse: collapse;
        border-spacing: 0px;
      }
      table,
      th,
      td {
        padding: 5px;
        border: 1px solid black;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <table>
        <tr>
            <th>Contract Address</th>
            <th>File Name</th>
            <th>Coverage</th>
        </tr>
        ${table}
    </table>
  </body>
</html>
`;
}

function buildCoveragePage() {
    let data = [['Contract Address', 'File Name', 'Coverage']];
    let output = '';

    let files;
    try {
        files = fs.readFileSync(path.join(dir, 'workdir/files.json'));
    } catch (err) {
        console.log('files.json not found, skipping coverage page generation');
        return;
    }
    const filesJson = JSON.parse(files.toString());

    let coverage;
    try {
        coverage = fs.readFileSync(path.join(dir, 'workdir/coverage.json'));
    } catch (err) {
        console.log('coverage.json not found, skipping coverage page generation');
        return;
    }

    const coverageJson = JSON.parse(coverage.toString());
    const transformedContractFiles = getTransformedContractFiles(filesJson);
    const transformedCoverageJson = getTransformedCoverageJson(coverageJson, transformedContractFiles);

    Object.entries(transformedCoverageJson)
        .sort((a, b) => {
            const [keyA, valueA] = a;
            const [keyB, valueB] = b;

            const highlighLineCountA = getHighlightLineCount(valueA, transformedContractFiles[keyA]);
            const highlightBlockCountA = highlighLineCountA / transformedContractFiles[keyA].split('\n').length;
            const highlighLineCountB = getHighlightLineCount(valueB, transformedContractFiles[keyB]);
            const highlightBlockCountB = highlighLineCountB / transformedContractFiles[keyB].split('\n').length;

            return highlightBlockCountB - highlightBlockCountA;
        })
        .map(([key, value]) => {
            const [address, filename] = key.split('__');
            const code = transformedContractFiles[key];
            const lineCount = (code.match(/\n/g) || []).length + 1;
            const highlightLineCount = getHighlightLineCount(value, code);
            const coverage = calculatePercentage(highlightLineCount, lineCount);

            output += `<tr>
                <td>${address}</td>
                <td>${filename}</td>
                <td>${coverage}</td>
            </tr>`;

            data.push([address, filename, coverage]);
        });

    console.log(table(data));

    try {
        fs.writeFileSync('./workdir/coverage.html', generateHTML(output));
    } catch (err) {
        console.error('save file error: ', err);
    }
}

module.exports = {
    buildCoveragePage,
};
