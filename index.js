const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Set the list of Discord usernames allowed to access
const ALLOWED_USERNAMES = process.env.ALLOWED_USERS ? process.env.ALLOWED_USERS.split(',') : [];

// Set the mapping of URL suffixes to their corresponding target URLs
const TARGET_URLS = process.env.TARGET_URLS ? JSON.parse(process.env.TARGET_URLS) : {};

// Ensure the SESSION_SECRET environment variable is set
if (!process.env.SESSION_SECRET) {
    console.error('SESSION_SECRET must be set in environment variables.');
    process.exit(1);
}

passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: ['identify']
}, (accessToken, refreshToken, profile, done) => {
    done(null, profile);
}));

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

app.get('/', (req, res) => {
    if (req.isAuthenticated()) {
        if (ALLOWED_USERNAMES.includes(req.user.username)) {
            res.render('home', { suffixes: Object.keys(TARGET_URLS), username: req.user.username });
        } else {
            res.send('You are not authorized to access this page.');
        }
    } else {
        res.render('login', { suffix: '' });
    }
});

app.get('/auth/discord', (req, res, next) => {
    passport.authenticate('discord')(req, res, next);
});

app.get('/callback',
    passport.authenticate('discord', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect('/');
    }
);

app.get('/serve/:suffix', async (req, res) => {
    if (req.isAuthenticated()) {
        const suffix = req.params.suffix;
        let targetUrl = TARGET_URLS[suffix];
        let maxRedirects = 10;  // 设置最大重定向次数

        if (targetUrl) {
            try {
                while (maxRedirects > 0) {
                    const response = await axios.get(targetUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
                        },
                        maxRedirects: 0,  // 自行处理重定向
                        validateStatus: function (status) {
                            return status >= 200 && status < 400; // 接受所有 2xx 和 3xx 响应
                        }
                    });

                    if (response.status >= 300 && response.status < 400 && response.headers.location) {
                        targetUrl = response.headers.location;
                        maxRedirects--;
                    } else {
                        response.data.pipe(res); // 流式传递响应到客户端
                        return;
                    }
                }
                throw new Error('Maximum number of redirects exceeded');

            } catch (error) {
                console.error('Error fetching the target URL:', error.message);
                console.error('Error details:', error.response ? error.response.data : 'No response data');
                res.status(500).send('Error fetching the target URL.');
            }
        } else {
            res.send('Invalid URL suffix.');
        }
    } else {
        res.render('login', { suffix: req.params.suffix });
    }
});

app.get('/logout', (req, res) => {
    req.logout(() => {
        res.redirect('/');
    });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
