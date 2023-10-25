
function randomAddress() {
    let address = "0x";
    for (let i = 0; i < 40; i++) {
        address += Math.floor(Math.random() * 16).toString(16);
    }
    return address;
}

module.exports = {
    randomAddress
}