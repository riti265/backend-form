const bcrypt = require('bcrypt');

bcrypt.hash("Surgical@2026Secure", 10).then(hash => {
    console.log("Your Hashed Password:");
    console.log(hash);
});