const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');
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

// Configure Discord OAuth2
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

// Root route for displaying the suffix buttons
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

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/callback', 
    passport.authenticate('discord', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect('/');
    }
);

// Apply proxy middleware for each target URL
Object.keys(TARGET_URLS).forEach(suffix => {
    const target = TARGET_URLS[suffix];
    app.use(`/proxy/${suffix}`, (req, res, next) => {
        if (req.isAuthenticated() && ALLOWED_USERNAMES.includes(req.user.username)) {
            createProxyMiddleware({
                target,
                changeOrigin: true,
                pathRewrite: { [`^/proxy/${suffix}`]: '' }
            })(req, res, next);
        } else {
            res.status(403).send('Forbidden');
        }
    });
});

app.get('/logout', (req, res) => {
    req.logout();
    res.redirect('/');
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
