const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  discordId: String,
  votes: [{
    botID: String,
    time: Date
  }]
});

const UserModel = mongoose.model('User', userSchema);
module.exports = UserModel;
