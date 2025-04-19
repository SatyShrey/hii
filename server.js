/* eslint-disable no-undef */
const express = require('express');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const moment = require('moment-timezone')
const cors = require('cors');
const jwt = require("jsonwebtoken");
const bcrypt = require('bcrypt');
const cookieParser = require("cookie-parser");
const app = express();
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const upload = multer({ dest: './uploads/' });

//environment variables
require('dotenv').config();
const conStr = process.env.MONGODB;
const SECRET_KEY = process.env.KEY;

app.use(cors({ origin: ["https://hi-messanger.netlify.app","http://localhost:5173"], credentials: true }));

const mongoClient = require('mongodb').MongoClient;

const http = require('http')
const { Server } = require('socket.io');
const server = http.createServer(app)
const io = new Server(server, { cors: {} });
const port = 6060;

let connectedUsers = new Set();
function getConnectedUsers() {
    return Array.from(connectedUsers);
}

//bcrypt hashpassword
const hashPassword = async (plainText) => {
    const saltRounds = 10;
    const hash = await bcrypt.hash(plainText, saltRounds);
    return hash;
};
//check password
const checkPassword = async (plainText, hash) => {
    const match = await bcrypt.compare(plainText, hash);
    return match;
};


//cloudinary Configuration
cloudinary.config({
    cloud_name: 'dptdikuo6',
    api_key: '161827842144876',
    api_secret: 'eEjhM3E_kxhlhrLm17GYB5-id8A'
});

app.post('/upload', upload.single('image'), (req, res) => {
    cloudinary.uploader.upload(req.file.path, (error, result) => {
        if (error) {
            console.error(error);
            res.status(500).send({ message: 'Error uploading image' });
        } else {
            res.send(result.url);
        }
    });
});

//default page
app.get('/', (req, res) => {
    res.send('Server Live');
})

//socket.io
io.on('connection', async (socket) => {
    const userId = socket.handshake.query.userId;
    socket.join(userId);
    connectedUsers.add(userId);

    //update online status
    mongoClient.connect(conStr).then(clientObject => {
        const db = clientObject.db('hii');
        const timestamp = Date.now();
        const istDateTime = moment(timestamp).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss')
        db.collection('users').updateOne({ email: userId }, { $set: { lastseen: istDateTime } }).then(() => {
            //broadcast online status
            io.emit('online-offline', getConnectedUsers());
        })
    })

    socket.on('chat', (data) => {
        mongoClient.connect(conStr).then(clientObject => {
            let db = clientObject.db('hii');
            db.collection('chats').insertOne(data).then(() => {
                io.to(data.receiver).emit('chat', data);
            }).then(() => {
                io.to(data.sender).emit('status', 200);
            }).catch(e => { io.to(data.sender).emit('status', e); })
        }).catch(e => { io.to(data.sender).emit('status', e); })
    });

    //user disconnects
    socket.on('disconnect', () => {
        //update online status
        connectedUsers.delete(userId);

        mongoClient.connect(conStr).then(clientObject => {
            const db = clientObject.db('hii');
            const timestamp = Date.now();
            const istDateTime = moment(timestamp).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss')
            db.collection('users').updateOne({ email: userId }, { $set: { lastseen: istDateTime } }).then(() => {
                //broadcast online status
                io.emit('online-offline', getConnectedUsers());
            })
        })
    });

});

//mongodb
mongoClient.connect(conStr).then(clientObject => {
    let db = clientObject.db('hii');

    //change profile pic
    app.post('/changepic', upload.single('image'), (req, res) => {
        const email = req.body.email;
        cloudinary.uploader.upload(req.file.path, (error, result) => {
            if (error) {
                console.error(error);
                res.status(500).send({ message: 'Error uploading image' });
            } else {
                db.collection('users').updateOne({ email: email }, { $set: { photoURL: result.url } }).then(() => {
                    res.send({ photoURL: result.url, status: 200 });
                })
            }
        });
    })
    //change password
    app.put('/changepassword', async(req, res) => {
        const email = req.body.email;
        db.collection('users').updateOne({ email: email }, { $set: { password: await hashPassword(req.body.password)} }).then(() => {
            res.send({ status: 200 });
        })
    })
    //signup
    app.post('/signup/', (req, res) => {
        db.collection('users').findOne({ email: req.body.email }).then(async (user) => {
            if (user) { res.send('User already registered') }
            else {
                const newUser = req.body;
                const hashedUser = { ...newUser, password: await hashPassword(req.body.password) }
                db.collection('users').insertOne(hashedUser).then(() => {
                    res.send(200)
                })
            }
        })
    })

    //user login
    app.post('/login', (req, res) => {
        const { email, password } = req.body;
        db.collection('users').findOne({ email }).then(async (user) => {
            if (!user || !(await checkPassword(password, user.password))) { res.send("Invalid credentials"); return; }

            const token = jwt.sign(user, SECRET_KEY, { expiresIn: "1h" });
            res.cookie("authToken", token, { httpOnly: true, secure: true, sameSite: "None" });
            res.send({ user: user, status: 200 });
        })
    })

    //google login
    app.post('/googlelogin', (req, res) => {
        db.collection('users').findOne({ email: req.body.email }).then(async (user) => {
            if (!user) {
                res.send('This email has not registered.'); return;
            }

            const token = jwt.sign(user, SECRET_KEY, { expiresIn: "1h" });
            res.cookie("authToken", token, { httpOnly: true, secure: true, sameSite: "None" });
            res.send({ user: user, status: 200 });
        })

    });

    //google signup
    app.post('/googlesignup', (req, res) => {
        db.collection('users').findOne({ email: req.body.email }).then(async (user) => {
            if (user) {
                res.send('This email already registered.'); return;
            }
            db.collection('users').insertOne(req.body).then(()=>{
                res.send({ user: user, status: 200 });
            })
        })

    });

    //get all users
    app.get('/users', (req, res) => {
        db.collection('users').find({}).toArray().then(users => {
            res.send(users); res.end();
        })
    });

    //get user by id
    app.get('/user/:id', (req, res) => {
        db.collection('users').find({ email: req.params.id }).then(user => {
            res.send(user); res.end();
        })
    });

    //get all chats
    app.get('/chats/:p1', (req, res) => {
        db.collection('chats').find({ $or: [{ sender: req.params.p1 }, { receiver: req.params.p1 }] }).toArray().then(chats => {
            res.send(chats); res.end();
        })
    });

    //delete user
    app.delete('/deleteuser/:id', (req, res) => {
        db.collection('chats').deleteMany({ $or: [{ sender: req.params.id }, { receiver: req.params.id }] }).then(() => {
            db.collection('users').deleteOne({ email: req.params.id }).then(() => {
                res.send('User deleted'); res.end();
            })
        })

    })

    //check logged in user
    app.get("/checkuser", async (req, res) => {
        const token = req.cookies.authToken;
        if (!token) return res.send("Unauthorized");
        try {
            const decoded = jwt.verify(token, SECRET_KEY);
            const db = (await mongoClient.connect(conStr)).db('hii');
            const user = await db.collection('users').findOne({email:decoded.email});
            const users = await db.collection('users').find({}).toArray();
            const chats = await db.collection('chats').find({}).toArray();
            const message = (`Hello, ${decoded.displayName}, welcome to the dashboard!`);
            const data = { user: user, users: users.filter(a => a.email != decoded.email), chats: chats, status: 200, message: message }
            res.send(data);
            // eslint-disable-next-line no-unused-vars
        } catch (error) {
            res.send("Invalid token");
        }
    });

});//...momgo client....



//listen to the server
server.listen(port, () => { console.log(`Server started at port:${port}`) })