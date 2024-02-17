// Import required modules
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setup
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// Session setup
app.use(session({
    secret: 'secret',
    resave: true,
    saveUninitialized: true
}));

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Internal Server Error');
});

// Passport middleware setup
app.use(passport.initialize());
app.use(passport.session());

// MongoDB connection setup
mongoose.connect('mongodb://localhost:27017/reporting', { useNewUrlParser: true, useUnifiedTopology: true });
const db = mongoose.connection;

db.on('error', (error) => {
    console.error('MongoDB connection error:', error);
});

db.once('open', () => {
    console.log('Connected to MongoDB');
});

// Define user schema
const userSchema = new mongoose.Schema({
    name: String,
    password: String
});

// Define post schema
const postSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    incident: String,
    problem: String,
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    comments: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        text: String,
        timestamp: { type: Date, default: Date.now }
    }]
});

// Create user model
const User = mongoose.model('User', userSchema);

// Create post model
const Post = mongoose.model('Post', postSchema);

// Passport local strategy for authentication
passport.use(new LocalStrategy(
    async function(username, password, done) {
        try {
            const user = await User.findOne({ name: username });
            if (!user) {
                return done(null, false, { message: 'Incorrect username.' });
            }
            const isPasswordMatch = await bcrypt.compare(password, user.password);
            if (!isPasswordMatch) {
                return done(null, false, { message: 'Incorrect password.' });
            }
            return done(null, user);
        } catch (error) {
            return done(error);
        }
    }
));

// Serialize and deserialize user for session management
passport.serializeUser(function(user, done) {
    done(null, user.id);
});

passport.deserializeUser(async function(id, done) {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (error) {
        done(error);
    }
});

// Routes
app.get('/', isAuthenticated, async (req, res) => {
    try {
        const posts = await Post.find({}).populate('user').populate({
            path: 'comments',
            populate: { path: 'user' }
        });
        res.render('home', { user: req.user, posts: posts });
    } catch (error) {
        console.error('Error fetching posts:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', passport.authenticate('local', { 
    successRedirect: '/', 
    failureRedirect: '/login', 
    failureFlash: true 
}));

app.get('/signup', (req, res) => {
    res.render('signup'); // Assuming you have a signup.ejs file in your views directory
});

app.post('/signup', async (req, res) => {
    const { username, password } = req.body;

    try {
        // Check if the username already exists in the database
        const existingUser = await User.findOne({ name: username });
        if (existingUser) {
            return res.status(400).send('Username already exists');
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create a new user
        const newUser = new User({
            name: username,
            password: hashedPassword
        });

        // Save the new user to the database
        await newUser.save();

        // Redirect the user to the login page after successful signup
        res.redirect('/login');
    } catch (error) {
        console.error('Error signing up user:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/add-post', isAuthenticated, (req, res) => {
    res.render('add-post');
});

app.post('/add-post', isAuthenticated, async (req, res) => {
    const { incident, problem } = req.body;

    try {
        const newPost = new Post({
            user: req.user._id,
            incident: incident,
            problem: problem
        });

        await newPost.save();

        res.redirect('/');
    } catch (error) {
        console.error('Error adding post:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Like 
app.post('/like/:postId', isAuthenticated, async (req, res) => {
    try {
        const postId = req.params.postId;

        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).send('Post not found');
        }

        if (post.likes.includes(req.user._id)) {
            return res.status(400).send('You have already liked this post');
        }

        post.likes.push(req.user._id);

        await post.save();

        res.redirect('/');
    } catch (error) {
        console.error('Error liking post:', error);
        res.status(500).send('Internal Server Error');
    }
});
 
// Comments
app.post('/comment/:postId', isAuthenticated, async (req, res) => {
    try {
        const postId = req.params.postId;
        const { comment } = req.body;

        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).send('Post not found');
        }

        post.comments.push({ user: req.user._id, text: comment });

        await post.save();

        res.redirect('/');
    } catch (error) {
        console.error('Error submitting comment:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Define profile route
app.get('/profile', isAuthenticated, async (req, res) => {
    try {
        // Fetch total number of posts for the current user
        const totalPosts = await Post.countDocuments({ user: req.user._id });

        // Fetch total number of comments for the current user
        const totalComments = await Post.countDocuments({ 'comments.user': req.user._id });

        // Render the profile page with user data
        res.render('profile', { user: req.user, totalPosts: totalPosts, totalComments: totalComments });
    } catch (error) {
        console.error('Error fetching profile data:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Delete post route
app.post('/delete-post/:postId', isAuthenticated, async (req, res) => {
    try {
        const postId = req.params.postId;

        // Find the post by ID
        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).send('Post not found');
        }

        // Check if the current user is the owner of the post
        if (post.user.toString() !== req.user._id.toString()) {
            return res.status(403).send('You are not authorized to delete this post');
        }

        // Remove the post document
        await post.deleteOne();

        // Redirect to the home page or any other appropriate page
        res.redirect('/');
    } catch (error) {
        console.error('Error deleting post:', error);
        res.status(500).send('Internal Server Error: ' + error.message);
    }
});

// Logout
app.get('/logout', (req, res) => {
    req.logout(() => {
        res.redirect('/login');
    });
});

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
}

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
