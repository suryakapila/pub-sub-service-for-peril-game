import { ArmyMove, RecognitionOfWar } from "../internal/gamelogic/gamedata.js";
import { GameState, PlayingState } from "../internal/gamelogic/gamestate.js";
import { handleMove, MoveOutcome } from "../internal/gamelogic/move.js";
import { handlePause } from "../internal/gamelogic/pause.js";
import { AckType, publishJSON, publishGameLog } from "../internal/pubsub/util.js";
import { ExchangePerilTopic, WarRecognitionsPrefix } from "../internal/routing/routing.js";
import { ConfirmChannel } from "amqplib";
import { handleWar, WarOutcome } from "../internal/gamelogic/war.js";
import { GameLog, writeLog } from "../internal/gamelogic/logs.js";



export function handlerPause(gs: GameState): (ps:PlayingState) => AckType {
    return function(ps:PlayingState): AckType {
        handlePause(gs, ps);
        process.stdout.write("> ");
        return AckType.ack;
    };
}

export function handlerMove(gs: GameState, ch: ConfirmChannel): (am: ArmyMove) => Promise<AckType> {
    return async function(am: ArmyMove): Promise<AckType> {
        try{
            const outcome = handleMove(gs, am);
            switch(outcome){
                case MoveOutcome.Safe:
                case MoveOutcome.SamePlayer:
                    return AckType.ack;
                case MoveOutcome.MakeWar:
                    const recognition: RecognitionOfWar = {
                        attacker : am.player,
                        defender : gs.getPlayerSnap(),
                    };
                    const routingKey = `${WarRecognitionsPrefix}.${gs.getUsername()}`;
                    try{
                        await publishJSON(ch, ExchangePerilTopic, routingKey, recognition);
                        return AckType.ack;
                    }catch(err){
                        console.log("Failed to publish war recognition:", err);
                        return AckType.nackRequeue;
                    }
                default:
                    return AckType.nackDiscard;

            }
        }finally{
            process.stdout.write("> ");
        }
    };
}

export function handlerWar(gs: GameState, ch: ConfirmChannel): (war: RecognitionOfWar) => Promise<AckType> {
    return async function(war: RecognitionOfWar): Promise<AckType> {
       try{
            const outcome = handleWar(gs, war);
            switch(outcome.result){
                case WarOutcome.NotInvolved:
                    return AckType.nackRequeue;
                case WarOutcome.NoUnits:
                    return AckType.nackDiscard;
                case WarOutcome.OpponentWon:
                    try{
                        await publishGameLog(ch, gs.getUsername(), `${outcome.winner} won a war against ${outcome.loser}`);
                        return AckType.ack;
                    }catch(err){
                        console.log("Failed to publish game log:", err);
                        return AckType.nackRequeue;
                    }

                case WarOutcome.YouWon:
                    try{
                        await publishGameLog(ch, gs.getUsername(), `${outcome.winner} won a war against ${outcome.loser}`);
                        return AckType.ack;
                    }catch(err){
                        console.log("Failed to publish game log:", err);
                        return AckType.nackRequeue;
                    }
                case WarOutcome.Draw:
                    try{
                        await publishGameLog(ch, gs.getUsername(), `A war between ${war.attacker} and ${war.defender} resulted in a draw`);
                        return AckType.ack;
                    }catch(err){
                        console.log("Failed to publish game log:", err);
                        return AckType.nackRequeue;
                    }
                default:
                    console.log("Invalid war outcome");
                    return AckType.nackDiscard;
            }    
        }finally{
            process.stdout.write("> ");
        }
    };
}

export function handlerLog() {
  return async (gamelog: GameLog): Promise<AckType> => {
    try {
      writeLog(gamelog);
      return AckType.ack;
    } catch (err) {
      console.error("Error writing log:", err);
      return AckType.nackDiscard;
    } finally {
      process.stdout.write("> ");
    }
  };
}