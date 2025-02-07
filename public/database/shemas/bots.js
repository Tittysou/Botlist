const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const BotSchema = new Schema({
  botID: String,
  appID: String,
  owner: String,
  prefix: String,
  backURL: String,
  inviteURL: String,
  supportURL: String,
  websiteURL: String,
  githubURL: String,
  webhookURL: String,
  shortDesc: String,
  longDesc: String,
  tags: [String],
  votes: { type: Number, default: 0 },
});

module.exports = mongoose.model('Bot', BotSchema);

