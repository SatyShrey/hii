/* eslint-disable no-undef */

const express = require('express');
const app = express();
const cors = require('cors');
const allowedOrigins = ["https://hi-messanger.netlify.app", "http://localhost:5173"];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  })
);

const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const moment = require('moment-timezone')
const bcrypt = require('bcrypt');
const cookieParser = require("cookie-parser");
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const upload = multer({ dest: './uploads/' });

//environment variables
require('dotenv').config();
const conStr = process.env.MONGODB;

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
    app.put('/changepassword', async (req, res) => {
        const email = req.body.email;
        db.collection('users').updateOne({ email: email }, { $set: { password: await hashPassword(req.body.password) } }).then(() => {
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
            res.send({ user: user, status: 200 });
        })
    })

    //google login
    app.post('/googlelogin', (req, res) => {
        db.collection('users').findOne({ email: req.body.email }).then(async (user) => {
            if (!user) {
                res.send('This email has not registered.'); return;
            }
            res.send({ user: user, status: 200 });
        })

    });

    //google signup
    app.post('/googlesignup', (req, res) => {
        db.collection('users').findOne({ email: req.body.email }).then(async (user) => {
            if (user) {
                res.send('This email already registered.'); return;
            }
            db.collection('users').insertOne(req.body).then(() => {
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
    app.post("/checkuser", async (req, res) => {
        db.collection('users').findOne(req.body).then(async(user) => {
            if (user) {
                const users = await db.collection('users').find({}).toArray();
                const chats = await db.collection('chats').find({}).toArray();
                const data = { user: user, users: users.filter(a => a.email != user.email), chats: chats, status: 200 }
                res.send(data);
            }
            else{ res.send('Login expired!') }
        })

    });

});//...momgo client....



//listen to the server
server.listen(port, () => { console.log(`Server started at port:${port}`) })