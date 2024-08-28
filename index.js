const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const app = express();
const port = process.env.PORT || 3000;

// Set the list of Discord user IDs allowed to access
const ALLOWED_USERS = process.env.ALLOWED_USERS ? process.env.ALLOWED_USERS.split(',') : [];

// Set the mapping of URL suffixes to their corresponding target URLs
const TARGET_URLS = process.env.TARGET_URLS ? JSON.parse(process.env.TARGET_URLS) : {};

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

app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

// Handling of different URL suffixes
app.get('/:suffix', (req, res) => {
    if (req.isAuthenticated()) {
        if (ALLOWED_USERS.includes(req.user.id)) {
            const targetUrl = TARGET_URLS[req.params.suffix];
            if (targetUrl) {
                res.redirect(targetUrl);
            } else {
                res.send('Invalid URL suffix.');
            }
        } else {
            res.send('You are not authorized to access this page.');
        }
    } else {
        res.send('<a href="/auth/discord">Login with Discord</a>');
    }
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/callback', 
    passport.authenticate('discord', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect(`/${req.session.suffix || ''}`);
    }
);

app.get('/logout', (req, res) => {
    req.logout(() => {
        res.redirect('/');
    });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
