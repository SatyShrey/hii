/* eslint-disable no-undef */
const express = require('express');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const moment=require('moment-timezone')
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
require('dotenv').config(); 

//cloudinary Configuration
cloudinary.config({
    cloud_name: 'dptdikuo6',
    api_key: '161827842144876',
    api_secret: 'eEjhM3E_kxhlhrLm17GYB5-id8A'
});

const upload = multer({ dest: './uploads/' });

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

const mongoClient = require('mongodb').MongoClient;
const conStr =process.env.PORT || 'mongodb://localhost:27017/'

const http = require('http')
const { Server } = require('socket.io');
const server = http.createServer(app)
const io = new Server(server, { cors: {} });
const port = 6060;
let onlineUsers=[];

//default page
app.get('/', (req, res) => {
    res.send('Server Live');
})

//socket.io
io.on('connection', async(socket) => {
    const userId = socket.handshake.query.userId;
    socket.join(userId);
    let newOnlineUsers=[...onlineUsers,userId]
    socket.broadcast.emit('online', newOnlineUsers);
    onlineUsers=newOnlineUsers;
    
    //update online status
    mongoClient.connect(conStr).then(clientObject=>{
    const db=clientObject.db('hii');
    db.collection('users').updateOne({ email: userId }, { $set: { lastseen: 'online' } });
    })

    socket.on('chat', (data) => {
        mongoClient.connect(conStr).then(clientObject=>{
            let db=clientObject.db('hii');
            db.collection('chats').insertOne(data).then(()=>{
                io.to(data.receiver).emit('chat', data);
            }).then(()=>{
                io.to(data.sender).emit('status',200);
            }).catch(e=>{io.to(data.sender).emit('status',e);})
        }).catch(e=>{io.to(data.sender).emit('status',e);})
    });

    //user disconnects
        socket.on('disconnect', () => {
            //update online status
            mongoClient.connect(conStr).then(clientObject=>{
            const db=clientObject.db('hii');
            const timestamp =Date.now();
            const istDateTime=moment(timestamp).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss')
            db.collection('users').updateOne({ email: userId }, { $set: { lastseen: istDateTime } }).then(()=>{
                let newOnlineUsers=onlineUsers.filter(a=>a != userId)
                socket.broadcast.emit('offline',newOnlineUsers);
                onlineUsers=newOnlineUsers
            })
            })
        });


});

//mongodb
mongoClient.connect(conStr).then(clientObject => {
    let db = clientObject.db('hii');
    //google login
    app.post('/googlelogin', (req, res) => {
        db.collection('users').findOne({ email:req.body.email }).then((data) => {
        if (data) {
            res.send('Login success');
        }
        else {
            db.collection('users').insertOne(req.body).then(() => {
                res.send('Login success'); res.end();
            })
        }
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
        db.collection('users').find({email:req.params.id}).then(user => {
            res.send(user); res.end();
        })
    });

    //get all chats
    app.get('/chats/:p1', (req, res) => {
        db.collection('chats').find({$or:[{sender:req.params.p1},{receiver:req.params.p1}]}).toArray().then(chats => {
            res.send(chats); res.end();
        })
    });

    //delete user
    app.delete('/deleteuser/:id',(req,res)=>{
        db.collection('chats').deleteMany({$or:[{sender:req.params.id},{receiver:req.params.id}]}).then(() => {
            db.collection('users').deleteOne({email:req.params.id}).then(()=>{
                res.send('User deleted');res.end();
            })
        })
        
    })

});//...momgo client....



//listen to the server
server.listen(port, () => { console.log(`Server started at port:${port}`) })