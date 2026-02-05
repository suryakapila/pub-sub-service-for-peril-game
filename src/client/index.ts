import amqp, { ConfirmChannel } from "amqplib";
import { clientWelcome, commandStatus, getInput, getMaliciousLog, printClientHelp, printQuit } from "../internal/gamelogic/gamelogic.js";
import { declareAndBind, publishJSON } from "../internal/pubsub/util.js";
import { ArmyMovesPrefix, ExchangePerilDirect, ExchangePerilTopic, GameLogSlug, PauseKey } from "../internal/routing/routing.js";
import { GameState } from "../internal/gamelogic/gamestate.js";
import { commandSpawn } from "../internal/gamelogic/spawn.js";
import { commandMove } from "../internal/gamelogic/move.js";
import { handlerPause, handlerMove, handlerWar } from "./handlers.js";
import {subscribeJSON, SimpleQueueType, publishMsgPack} from "../internal/pubsub/util.js";


async function main() {
  console.log("Starting Peril client...");
  const connectionString = "amqp://guest:guest@localhost:5672/";
  const connection = await amqp.connect(connectionString);
  console.log("Client connected to RabbitMQ!");
  const channel: amqp.ConfirmChannel = await connection.createConfirmChannel();

  const username = await clientWelcome();
  const queueName:string = PauseKey+"."+username;
  const moveQueueName: string = ArmyMovesPrefix + "." + username;
  const moveRoutingKey: string = ArmyMovesPrefix + ".*";
  const warQueueName:string = "war";
  const warRoutingKey: string = "war.*";
  const newGameState = new GameState(username);
  await subscribeJSON(connection, ExchangePerilDirect, queueName, PauseKey, SimpleQueueType.Transient, handlerPause(newGameState));
  await subscribeJSON(connection, ExchangePerilTopic, moveQueueName, moveRoutingKey, SimpleQueueType.Transient, handlerMove(newGameState, channel));
  await subscribeJSON(connection, ExchangePerilTopic, warQueueName, warRoutingKey, SimpleQueueType.Durable, handlerWar(newGameState, channel));
  printClientHelp();
  while (1) {
      const words:any = await getInput();
      if (words.length === 0) continue;

      try {
        if (words[0] === "spawn") {
          commandSpawn(newGameState, words);
        } else if (words[0] === "move") {
          const success = commandMove(newGameState, words);
          if (success) {
            publishJSON(channel, ExchangePerilTopic, `${ArmyMovesPrefix}.${username}`, success);
            console.log(`Move command published to the server.`);
          } else console.log("Move failed!!");
        } else if (words[0] === "status") {
          commandStatus(newGameState);
        } else if (words[0] === "help") {
          printClientHelp();
        } else if (words[0] === "spam") {
          //console.log("Spamming not allowed yet!");
          let count = parseInt(words[1]) || 10;
          while(count-->0){
            const message = getMaliciousLog();
            await publishMsgPack(channel, ExchangePerilTopic, `${GameLogSlug}.${username}`, {
              username,
              message,
              currentTime: new Date(),
            });
            console.log(`Sent malicious log: ${message}`);
          }
        } else if (words[0] === "quit") {
          printQuit();
          break;
        } else {
          console.log("command not found");
        }
      } catch (err: any) {
        console.log(err.message ?? String(err));
      }
  }
  
  process.on("SIGINT", async()=>{
    console.log("Shutting down gracefully...");
    await connection.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
