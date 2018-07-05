去中心化带宽检测

CAN Box 网络某个节点记为 A，随机生成一个 160bit Hash 字符串,记为 r。
A 向 CAN Box 网络发起请求获取与 r 最接近的节点 B。
令 A 与 B 互为 Server 和 Client 发起 TCP 连接，
三次握手连接后，客户端带宽大小等于发送的总数据除以发送时间，
服务端测得的带宽，则是接收的总数据除以所花时间。
测试完成后，A 与 B 向 CAN 公链广播存储带宽测试结果:
Result A = {
    Node: A,
    Peer: B,
    Send: N1 Mbits/sec,
    Recv: N2 Mbits/sec
}
Result B = {
    Node: B,
    Peer: A,
    Send: N3 Mbits/sec,
    Recv: N4 Mbits/sec
}
公链节点需校验 A，B 带宽测试结果同时存在，并且在一定合理误差范围内。
