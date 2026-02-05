import type { ConfirmChannel, ChannelModel, Replies, Channel, ConsumeMessage } from "amqplib";
import { Encoder, decode } from "@msgpack/msgpack";
import type { GameLog } from "./../gamelogic/logs.js";
import { ExchangePerilTopic, GameLogSlug } from "../routing/routing.js";

export function publishGameLog(channel: ConfirmChannel,  username: string,  message: string): Promise<void> {
  const gameLog = {
    username,
    message,
    currentTime: new Date(),
  } as GameLog;
  return publishMsgPack(channel, ExchangePerilTopic, `${GameLogSlug}.${username}`, gameLog);
}
export enum AckType {
  ack = "ack",
  nackRequeue = "nack-requeue",
  nackDiscard = "nack-drop",
}

export enum SimpleQueueType {
  Durable = "durable",
  Transient = "transient",
}

export function publishJSON<T>(
  ch: ConfirmChannel,
  exchange: string,
  routingKey: string,
  value:T,
): Promise<void> {
  return new Promise((resolve, reject) =>{
    const content = Buffer.from(JSON.stringify(value));
    ch.publish(
      exchange,
      routingKey,
      content,
      {contentType: "application/json"},
      (err: any, ok: any) =>{
        if(err){
          reject(err);
        } else{
          resolve();
        }
      }
    );
  });
}

export function publishMsgPack<T>(
  ch: ConfirmChannel,
  exchange: string,
  routingKey: string,
  value:T,
): Promise<void> {
  return new Promise((resolve, reject) =>{
    const encoder = new Encoder();
    const encoded: Uint8Array = encoder.encode(value);
    const content: Buffer = Buffer.from(encoded);
    ch.publish(
      exchange,
      routingKey,
      content,
      {contentType: "application/x-msgpack"},
      (err: any, ok: any) =>{
        if(err){
          reject(err);
        } else{
          resolve();
        }
      }
    );
  });
}

export async function declareAndBind(
  conn: ChannelModel,
  exchange: string,
  queueName: string,
  key: string,
  queueType: SimpleQueueType
): Promise<[Channel, Replies.AssertQueue]>{
  const channel: Channel = await conn.createChannel();
  const deadLetterExchange = "peril_dlx";
  const queueOptions = {
    durable: queueType === SimpleQueueType.Durable,
    autoDelete: queueType === SimpleQueueType.Transient,
    exclusive: queueType === SimpleQueueType.Transient,
    arguments:{
      "x-dead-letter-exchange": deadLetterExchange,
    }
  };
  const queue = await channel.assertQueue(queueName, queueOptions);
  await channel.bindQueue(queue.queue, exchange, key);
  
  return [channel, queue];
};

export async function subscribeJSON<T>(
  conn: ChannelModel,
  exchange: string,
  queueName: string,
  key: string,
  queueType: SimpleQueueType, // an enum to represent "durable" or "transient"
  handler: (data: T) => AckType | Promise<AckType>,
): Promise<void> {
 return subscribe(
  conn,
  exchange,
  queueName,
  key,
  queueType,
  handler,
  (data) => JSON.parse(data.toString("utf-8")),
);
}


export async function subscribeMsgPack<T>(
  conn: ChannelModel,
  exchange: string,
  queueName: string,
  key: string,
  queueType: SimpleQueueType, // an enum to represent "durable" or "transient"
  handler: (data: T) => AckType | Promise<AckType>,
): Promise<void> {
  return subscribe(
  conn,
  exchange,
  queueName,
  key,
  queueType,
  handler,
  (data) => decode(data) as T,
);
}


export async function subscribe<T>(
  conn: ChannelModel,
  exchange: string,
  queueName: string,
  routingKey: string,
  simpleQueueType: SimpleQueueType,
  handler: (data: T) => Promise<AckType> | AckType,
  unmarshaller: (data: Buffer) => T,
): Promise<void>{
  const [channel, queue] = await declareAndBind(conn, exchange, queueName, routingKey, simpleQueueType);
  await channel.prefetch(10);
  await channel.consume(queue.queue, async(msg: ConsumeMessage | null) => {
    if(msg === null) return;
    if(msg){
      const data: T = unmarshaller(msg.content);
      const res = await handler(data);
      if(res === AckType.ack){
        console.log("Acknowledging message");
        channel.ack(msg);
      } else if(res === AckType.nackRequeue){
        console.log("Nacking and requeuing message");
        channel.nack(msg, false, true);
      } else if(res === AckType.nackDiscard){
        console.log("Nacking and dropping message");
        channel.nack(msg, false, false);
      }
    }
  }); 
}

