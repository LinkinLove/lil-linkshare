const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
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
    return done(null, profile);
}));

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

app.set('view engine', 'ejs');

app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// Middleware for authentication check
const ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated() && ALLOWED_USERNAMES.includes(req.user.username)) {
        console.log(`User ${req.user.username} authenticated and authorized.`);
        return next();
    } else {
        console.log(`User ${req.user ? req.user.username : 'unknown'} not authorized.`);
        res.redirect('/');
    }
};

// Root route
app.get('/', (req, res) => {
    if (req.isAuthenticated()) {
        if (ALLOWED_USERNAMES.includes(req.user.username)) {
            res.render('home', { 
                suffixes: Object.keys(TARGET_URLS), 
                username: req.user.username,
                selectedSuffix: null
            });
        } else {
            res.send('You are not authorized to access this page.');
        }
    } else {
        res.render('login');
    }
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/callback',
    passport.authenticate('discord', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect('/');
    }
);

// Suffix route
app.get('/:suffix', ensureAuthenticated, (req, res) => {
    const suffix = req.params.suffix;
    if (TARGET_URLS.hasOwnProperty(suffix)) {
        res.render('home', { 
            suffixes: Object.keys(TARGET_URLS), 
            username: req.user.username,
            selectedSuffix: suffix
        });
    } else {
        res.status(404).send('Not found');
    }
});

// Proxy middleware
Object.keys(TARGET_URLS).forEach(suffix => {
    app.use(`/proxy/${suffix}`, ensureAuthenticated, createProxyMiddleware({
        target: TARGET_URLS[suffix],
        changeOrigin: true,
        pathRewrite: {
            [`^/proxy/${suffix}`]: ''
        },
        onProxyRes: (proxyRes, req, res) => {
            proxyRes.headers['X-Frame-Options'] = 'SAMEORIGIN';
        }
    }));
});

// Logout route
app.post('/logout', (req, res) => {
    console.log(`User ${req.user ? req.user.username : 'unknown'} logging out.`);
    req.logout((err) => {
        if (err) {
            console.error('Error during logout:', err);
            return res.status(500).json({ message: 'Error logging out' });
        }
        res.json({ message: 'Logged out successfully' });
    });
});

// Cookie sync endpoint
app.get('/sync-cookies', ensureAuthenticated, (req, res) => {
    console.log('Syncing cookies for user:', req.user.username);
    res.sendStatus(200);
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
