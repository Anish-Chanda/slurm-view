function getTresvalue(tresStr, key) {
    if (!tresStr) return "N/A"
    const match = tresStr.match(new RegExp(`${key}=([^,]+)`));
    return match ? match[1] : 'N/A';
}

module.exports = {
    getTresvalue
}