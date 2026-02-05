import amqp from "amqplib";
import {publishJSON, SimpleQueueType} from "../internal/pubsub/util.js";
import { ExchangePerilDirect,ExchangePerilTopic, PauseKey, GameLogSlug } from "../internal/routing/routing.js";
import type { PlayingState } from "../internal/gamelogic/gamestate.js";
import {getInput, printServerHelp} from "../internal/gamelogic/gamelogic.js";
import { declareAndBind, subscribeMsgPack } from "../internal/pubsub/util.js";
import { writeLog } from "../internal/gamelogic/logs.js";
import { subscribe } from "diagnostics_channel";
import { handlerLog } from "../client/handlers.js";

let state:PlayingState = {
  isPaused: true,
};

async function main() {
  console.log("Starting Peril server...");
  const connectionString = "amqp://guest:guest@localhost:5672/";
  const connection = await amqp.connect(connectionString);
  const confirmChannel = await connection.createConfirmChannel();

  console.log("Connected suceessfully to RabbitMQ!");


  const routingKey:string = GameLogSlug + ".*";
  //await declareAndBind(connection, ExchangePerilTopic, GameLogSlug, routingKey,  SimpleQueueType.Durable);
  await subscribeMsgPack(connection, ExchangePerilTopic, GameLogSlug, routingKey, SimpleQueueType.Durable, handlerLog());
  // Used to run the server from a non-interactive source, like the multiserver.sh file
  if (!process.stdin.isTTY) {
    console.log("Non-interactive mode: skipping command input.");
    return;
  }
  printServerHelp();
  while(1){
    const words = await getInput();
    if(words.length === 0) continue;
    else if(words[0] === "pause"){
      console.log("sending a pause message");
      state = {
        isPaused: true
      };
      publishJSON(confirmChannel, ExchangePerilDirect, PauseKey, state);
    }
    else if(words[0] === "resume"){
      console.log("sending a resume message");
      state = {
        isPaused: false
      };
      publishJSON(confirmChannel, ExchangePerilDirect, PauseKey, state);
    }
    else if(words[0]==="quit"){
      console.log("Exiting...");
      break;
    }
    else{
      console.log("command not found");
    }
  }
  await publishJSON(confirmChannel, ExchangePerilDirect, PauseKey, state);
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
