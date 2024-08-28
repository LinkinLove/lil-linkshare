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
    return done(null, profile);
}));

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Logging middleware
app.use((req, res, next) => {
    console.log(`Received request: ${req.method} ${req.url}`);
    next();
});

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax'
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Root route
app.get('/', (req, res) => {
    if (req.isAuthenticated()) {
        if (ALLOWED_USERNAMES.includes(req.user.username)) {
            res.render('home', {
                suffixes: Object.keys(TARGET_URLS),
                username: req.user.username,
                selectedSuffix: null  // 或者你想要的默认值
            });
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

// Authentication middleware
const ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated() && ALLOWED_USERNAMES.includes(req.user.username)) {
        console.log(`User ${req.user.username} authenticated and authorized.`);
        return next();
    } else {
        console.log(`User ${req.user ? req.user.username : 'unknown'} not authorized.`);
        res.status(403).send('Forbidden');
    }
};

// Proxy middleware
Object.keys(TARGET_URLS).forEach(suffix => {
    const target = TARGET_URLS[suffix];
    app.use(`/proxy/${suffix}`, ensureAuthenticated, createProxyMiddleware({
        target,
        changeOrigin: true,
        pathRewrite: {
            [`^/proxy/${suffix}`]: ''
        },
        cookieDomainRewrite: {
            '*': ''
        },
        onProxyReq: (proxyReq, req, res) => {
            if (req.session.passport && req.session.passport.user) {
                proxyReq.setHeader('X-Authenticated-User', req.session.passport.user.id);
            }
            // Add default environment parameter
            proxyReq.setHeader('X-Environment', 'production');
            console.log(`Proxying request ${req.originalUrl} to ${target}`);
        },
        onProxyRes: (proxyRes, req, res) => {
            const cookies = proxyRes.headers['set-cookie'];
            if (cookies) {
                const newCookies = cookies.map(cookie =>
                    cookie.replace(/Domain=[^;]+;/, '')
                          .replace(/Secure;?/, '')
                          .replace(/SameSite=[^;]+;?/, 'SameSite=Lax;')
                );
                proxyRes.headers['set-cookie'] = newCookies;
            }
            console.log(`Proxy response received for ${req.originalUrl}`);
        },
        onError: (err, req, res) => {
            console.error(`Error during proxying request ${req.originalUrl}:`, err);
            res.status(500).send('Proxy error');
        }
    }));
});

app.get('/logout', (req, res) => {
    req.logout();
    res.redirect('/');
});

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

// Cookie sync endpoint
app.get('/sync-cookies', (req, res) => {
    console.log('Received cookies:', req.headers.cookie);
    res.sendStatus(200);
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
