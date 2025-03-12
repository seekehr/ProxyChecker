import net from 'net';

const PORT = 0;
const PROXY = '';

const conn = net.createConnection(PORT, PROXY,  () => {
    console.log("hi");
    conn.end();
});