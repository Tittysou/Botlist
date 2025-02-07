const express = require('express');
const path = require('path');
const axios = require('axios');
const session = require('express-session');
const mongoose = require('mongoose');
const app = express();
const bodyParser = require('body-parser');
const config = require('./config.js');
const port = config.website.port;
const { Client } = require('discord.js');
const client = new Client({ intents: ['Guilds', 'GuildMessages', 'GuildMembers'] });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'your-secret-key', 
  resave: false,
  saveUninitialized: true
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

mongoose.connect(config.database.url, {
});

mongoose.connection.on('connected', () => {
  console.log('Mongoose connected to the database');
});

mongoose.connection.on('error', (err) => {
  console.error('Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('Mongoose disconnected');
});

const BotModel = require('./public/database/shemas/bots.js');
const UserModel = require('./public/database/shemas/user.js'); // Adjust the path to where your User model is located


const checkAdminRole = async (userId, accessToken) => {
  try {
    const response = await axios.get(`https://discord.com/api/v10/guilds/${config.server.id}/members/${userId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const userRoles = response.data.roles;
    return userRoles.includes(config.server.roles.admin);
  } catch (error) {
    console.error('Error fetching guild member information:', error);
    return false;
  }
};

app.get('/', (req, res) => {
  res.render('index', { user: req.session.user });
});

app.get('/about', (req, res) => {
  res.render('about');
});

app.get('/dashboard', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/');
  }

  const hasAdminRole = await checkAdminRole(req.session.user.id, req.session.accessToken);
  if (!hasAdminRole) {
    return res.redirect('/');
  }

  res.render('dashboard');
});

app.get('/auth/discord', (req, res) => {
  const redirectUri = `https://discord.com/oauth2/authorize?client_id=${config.client.id}&response_type=code&redirect_uri=${encodeURIComponent(config.website.callback)}&scope=identify`;
  res.redirect(redirectUri);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.redirect('/');
  }

  try {
    const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
      client_id: config.client.id,
      client_secret: config.client.secret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.website.callback,
      scope: 'identify'
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const { access_token } = tokenResponse.data;

    const userResponse = await axios.get('https://discord.com/api/v10/users/@me', {
      headers: {
        Authorization: `Bearer ${access_token}`
      }
    });

    req.session.user = userResponse.data;
    req.session.accessToken = access_token;

    res.redirect('/');
  } catch (error) {
    console.error('Error during Discord OAuth callback:', error);
    res.redirect('/');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).render('404', {
        bot: global.client ? global.client : null,
        path: req.path,
        user: req.session.user,
        req: req,
        message: 'It seems like an error has occurred. Please try again later. Contact support if the problem persists.'
      });
    }
    res.redirect('/');
  });
});

app.get('/all', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 15;
    const skip = (page - 1) * limit;

    // Fetch the bots from the database
    const bots = await BotModel.find().skip(skip).limit(limit);

    // Fetch additional details for each bot, including the avatar URL
    const botDetails = await Promise.all(
      bots.map(async (bot) => {
        try {
          // Fetch user information from Discord
          const user = await client.users.fetch(bot.botID);
          return {
            ...bot.toObject(),
            username: user.username,
            avatarURL: user.displayAvatarURL() || 'https://cdn.discordapp.com/embed/avatars/0.png', // Fallback avatar URL
            botID: bot.botID
          };
        } catch (error) {
          // Handle errors (e.g., user not found or API issues)
          console.error('Error fetching user:', error);
          return {
            ...bot.toObject(),
            username: 'Unknown',
            avatarURL: 'https://cdn.discordapp.com/embed/avatars/0.png', // Fallback avatar URL
            botID: bot.botID
          };
        }
      })
    );

    // Calculate pagination
    const totalBots = await BotModel.countDocuments();
    const totalPages = Math.ceil(totalBots / limit);

    // Render the page with bot details
    res.render('bots/all', {
      bots: botDetails,
      currentPage: page,
      totalPages,
      user: req.session.user,
    });
  } catch (error) {
    console.error('Error fetching bots:', error);
    res.status(500).send('Internal Server Error');
  }
});



app.get('/api/top-bots', async (req, res) => {
  try {
    const bots = await BotModel.find().exec(); 

    const botDetails = await Promise.all(
      bots.map(async (bot) => {
        try {
          const user = await client.users.fetch(bot.botID); 
          return {
            ...bot.toObject(),
            username: user.username,
            avatarURL: user.displayAvatarURL() || 'https://cdn.discordapp.com/embed/avatars/0.png',
            botID: bot.botID 
          };
        } catch (error) {
          return {
            ...bot.toObject(),
            username: 'Unknown',
            avatarURL: 'https://cdn.discordapp.com/embed/avatars/0.png',
            botID: bot.botID
          };
        }
      })
    );

    botDetails.sort((a, b) => b.votes - a.votes); // Sort bots by votes
    const topBots = botDetails.slice(0, 5);

    res.json({ bots: topBots });
  } catch (error) {
    console.error('Error fetching top bots:', error);
    res.status(500).json({ error: 'Failed to fetch top bots.' });
  }
});



app.get('/bots/:id', async (req, res) => {
  const botId = req.params.id;

  if (!botId) {
    console.error('Bot ID is undefined.');
    return res.status(400).send('Bad Request: Bot ID is missing.');
  }

  try {
    // Fetch bot details
    const bot = await BotModel.findOne({ botID: botId });

    if (!bot) {
      return res.status(404).render('404', {
        message: 'Bot not found.',
        user: req.session.user
      });
    }

    let botUser = null;
    try {
      // Fetch bot user details from Discord
      botUser = await client.users.fetch(bot.botID);
      console.log(`Fetched user details: ${botUser.username}`);
    } catch (error) {
      console.error('Error fetching bot user details:', error);
    }

    res.render('bots/bots', {
      bot: {
        ...bot.toObject(),
        username: botUser ? botUser.username : 'Unknown',
        avatarURL: botUser ? botUser.displayAvatarURL() : 'https://cdn.discordapp.com/embed/avatars/0.png'
      },
      user: req.session.user
    });
  } catch (error) {
    console.error('Error fetching bot details:', error);
    res.status(500).send('Internal Server Error');
  }
});




app.get('/api/top-bots', async (req, res) => {
  try {
    const bots = await BotModel.find().exec();

    const botDetails = await Promise.all(bots.map(async (bot) => {
      try {
        const user = await client.users.fetch(bot.botID); 
        return {
          ...bot.toObject(),
          username: user.username,
          avatarURL: user.displayAvatarURL() || 'https://cdn.discordapp.com/embed/avatars/0.png'
        };
      } catch (error) {
        console.error(`Error fetching user ${bot.botID}:`, error);
        return {
          ...bot.toObject(),
          username: 'Unknown',
          avatarURL: 'https://cdn.discordapp.com/embed/avatars/0.png'
        };
      }
    }));

    botDetails.sort((a, b) => b.votes - a.votes); 
    const topBots = botDetails.slice(0, 5);

    res.json({ bots: topBots });
  } catch (error) {
    console.error('Error fetching top bots:', error);
    res.status(500).json({ error: 'Failed to fetch top bots.' });
  }
});

app.get('/vote/:botID', async (req, res) => {
  const { botID } = req.params;
  const userId = req.session.user ? req.session.user.id : null;

  if (!userId) {
    return res.status(403).json({ message: 'You must be logged in to vote.' });
  }

  try {
    let user = await UserModel.findOne({ discordId: userId }).exec();
    if (!user) {
      user = new UserModel({ discordId: userId, votes: [] });
    }

    const currentTime = new Date();
    const oneHourAgo = new Date(currentTime.getTime() - (60 * 60 * 1000));

    const existingVote = user.votes.find(vote => vote.botID === botID);

    if (existingVote && existingVote.time > oneHourAgo) {
      return res.status(429).json({ message: 'You can only vote once per bot every hour.' });
    }

    const bot = await BotModel.findOneAndUpdate(
      { botID: botID },
      { $inc: { votes: 1 } },
      { new: true }
    );

    if (!bot) {
      return res.status(404).json({ message: 'Bot not found' });
    }

    if (existingVote) {
      existingVote.time = currentTime; 
    } else {
      user.votes.push({ botID: botID, time: currentTime }); 
    }

    await user.save();

    res.json({ message: 'Vote added', votes: bot.votes });
  } catch (error) {
    console.error('Error updating votes:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


app.post('/bot/new', async (req, res) => {
  const botData = req.body;
  const owner = req.session.user ? req.session.user.id : null;

  if (!owner) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    console.log('Received bot data:', botData);
    botData.owner = owner;

    await BotModel.create(botData);
    res.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    res.json({ success: false, error: true, message: 'Failed to save bot data.' });
  }
});

app.get('/bots/:botID/edit', async (req, res) => {
  try {
    const botID = req.params.botID;
    const bot = await BotModel.findOne({ botID });
    const user = req.user || null; // If using authentication middleware

    if (!bot) {
      return res.status(404).send('Bot not found');
    }

    res.render('bots/edit', { bot, user });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

app.post('/bots/:botID/edit', async (req, res) => {
  try {
    const botID = req.params.botID;
    const { 
      prefix, backURL, supportURL, websiteURL, githubURL, webhookURL,
      shortDesc, longDesc, tags 
    } = req.body;

    const tagsArray = typeof tags === 'string' ? tags.split(',').map(tag => tag.trim()) : tags;

    const updatedBot = await BotModel.findOneAndUpdate(
      { botID },
      { 
        prefix, backURL, supportURL, websiteURL, githubURL, webhookURL,
        shortDesc, longDesc, tags: tagsArray
      },
      { new: true }
    );

    if (!updatedBot) {
      return res.status(404).send('Bot not found');
    }

    res.redirect(`/bots/${botID}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});



app.get('/bot/:botID/delete', async (req, res) => {
  const botId = req.params.botID;
  const userId = req.session.user ? req.session.user.id : null;

  if (!userId) {
    return res.redirect('/auth/discord'); // Redirect if not logged in
  }

  try {
    const bot = await BotModel.findOne({ botID: botId });
    if (!bot) {
      return res.status(404).send('Bot not found');
    }

    if (bot.owner !== userId) {
      return res.redirect('/'); // Redirect if not owner
    }

    await BotModel.findOneAndDelete({ botID: botId });
    console.log(`Bot with ID ${botId} has been deleted`);
    res.redirect('/');
  } catch (error) {
    console.error('Error deleting bot:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/users/:userId', async (req, res) => {
  const userId = req.params.userId;

  try {
    const user = await client.users.fetch(userId);
    if (!user) {
      return res.status(404).send('User not found');
    }

    const bots = await BotModel.find({ owner: userId }).exec();

    res.render('users/users', {
      user: {
        username: user.username,
        avatarURL: user.displayAvatarURL() || 'https://cdn.discordapp.com/embed/avatars/0.png', 
        id: userId
      },
      bots: bots.map(bot => ({
        ...bot.toObject(),
        avatarURL: bot.avatarURL || 'https://cdn.discordapp.com/embed/avatars/0.png' 
      }))
    });
  } catch (error) {
    console.error('Error fetching user details:', error);
    res.status(500).send('Internal Server Error');
  }
});


app.get('/submit', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/');
  }

  res.render('bots/submit', { user: req.session.user });
});

app.use((req, res, next) => {
  res.status(404);
  res.render('404'); 
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500);
  res.render('500');
});

client.login(config.client.token)

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});
