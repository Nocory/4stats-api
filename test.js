const crypto = require('crypto');
const validPW = "ddfbc49d225314681f1f2e872110960759df78d0646309918352563ca26d40fc"

const digest = crypto.createHash('sha256').update("").digest('hex');

console.log(digest)