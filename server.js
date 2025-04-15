/* eslint-disable no-undef */
const express = require('express');
const app = express();
const cors = require('cors');
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
require('dotenv').config();

//const bcrypt = require('bcrypt');

const mongoClient = require('mongodb').MongoClient;
const conStr =process.env.PORT || 'mongodb://localhost:27017/'

const http = require('http')
const { Server } = require('socket.io');
const server = http.createServer(app)
const io = new Server(server, { cors: {} });
const port = 6060;

//default page
app.get('/', (req, res) => {
    res.send('Server Live');
})

//socket.io
io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId;
    socket.join(userId);
    socket.broadcast.emit('user', userId);

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