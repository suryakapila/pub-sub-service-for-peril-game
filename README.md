# Pub/Sub Service for Peril Game

A multiplayer strategy game (inspired by Risk) built on an **event-driven pub/sub architecture** using **RabbitMQ** as the message broker. Players spawn armies, move them across continents, and fight wars -- all coordinated through asynchronous message passing.

Built as part of the [Learn Pub/Sub](https://www.boot.dev) course on [Boot.dev](https://www.boot.dev).

## Architecture

```
┌──────────┐         ┌─────────────┐         ┌──────────┐
│ Client A │ ──pub──>│  RabbitMQ   │──sub───> │ Client B │
│ (player) │ <──sub──│             │──sub───> │ (player) │
└──────────┘         │  Exchanges: │         └──────────┘
                     │  - direct   │
┌──────────┐         │  - topic    │         ┌──────────┐
│  Server  │ ──pub──>│             │──sub───> │ Server N │
│ (admin)  │ <──sub──│  + DLX      │         │ (worker) │
└──────────┘         └─────────────┘         └──────────┘
```

**Two RabbitMQ exchanges** drive all communication:

| Exchange | Type | Purpose |
|---|---|---|
| `peril_direct` | Direct | Pause/resume commands from server to all clients |
| `peril_topic` | Topic | Army moves, war declarations, and game logs |

**Routing keys** use wildcard patterns for flexible message filtering:

- `pause` -- broadcast game state changes
- `army_moves.*` -- per-player army movement events
- `war.*` -- war declaration and resolution events
- `game_logs.*` -- game event logging (consumed by server)

## What's Implemented

### Server
- Connects to RabbitMQ and creates a confirm channel
- Subscribes to game logs (MessagePack-encoded) from all players
- Sends **pause/resume** commands over a direct exchange
- Supports non-interactive mode for running multiple server instances in parallel

### Client
- Username-based identity; each client maintains its own `GameState`
- **Spawn** units (infantry, cavalry, artillery) at any of 6 continents
- **Move** units between locations; moves are published to the topic exchange
- **War** is automatically triggered when armies overlap -- power-based resolution with win/loss/draw outcomes
- **Status** display of current game state
- **Spam** command to flood logs (for testing backpressure handling)

### Pub/Sub Layer (`src/internal/pubsub/util.ts`)
- Generic `publishJSON<T>` / `publishMsgPack<T>` with publisher confirms
- Generic `subscribeJSON<T>` / `subscribeMsgPack<T>` with typed handler callbacks
- `declareAndBind()` -- queue creation with dead-letter exchange routing
- Three-way ACK handling: **ack**, **nack+requeue**, **nack+discard**
- Consumer prefetch limit of 10 for flow control

### Game Logic
- **War resolution**: calculates total power (infantry=1, cavalry=5, artillery=10) and determines winner
- **Collision detection**: detects overlapping unit locations across players to trigger wars
- **Pause/resume**: server broadcasts state; clients gate commands behind pause checks
- **Logging**: game events written to `game.log` with an intentional blocking `sleep(1000)` to simulate slow I/O and demonstrate backpressure

## Tech Stack

- **TypeScript** (ES modules, strict mode, `noUncheckedIndexedAccess`)
- **RabbitMQ 3.13** with management UI + STOMP plugin
- **amqplib** -- AMQP 0-9-1 client for Node.js
- **MessagePack** (`@msgpack/msgpack`) -- binary serialization for high-volume log messages
- **Docker** -- RabbitMQ container management

## Getting Started

### Prerequisites
- Node.js
- Docker

### Run RabbitMQ
```bash
npm run rabbit:start      # creates/starts the container (ports 5672, 15672)
npm run rabbit:stop       # stops the container
npm run rabbit:logs       # tails container logs
```

RabbitMQ management UI: http://localhost:15672 (guest/guest)

### Run the Game
```bash
npm run build             # compile TypeScript

# Terminal 1 -- start the server
npm run server

# Terminal 2+ -- start clients
npm run client
```

### Run Multiple Servers (competing consumers)
```bash
./src/scripts/multiserver.sh 3   # spins up 3 server instances
```

## Project Structure

```
src/
├── server/index.ts              # Server entry point (admin controls + log consumer)
├── client/
│   ├── index.ts                 # Client entry point (game commands + subscriptions)
│   └── handlers.ts              # Message handlers (pause, move, war, log)
├── internal/
│   ├── pubsub/util.ts           # RabbitMQ wrapper (publish, subscribe, queue management)
│   ├── routing/routing.ts       # Exchange names and routing key constants
│   └── gamelogic/
│       ├── gamestate.ts         # GameState class and PlayingState interface
│       ├── gamedata.ts          # Type definitions (Unit, Player, Location, ArmyMove, etc.)
│       ├── move.ts              # Move command + collision detection
│       ├── war.ts               # War resolution engine
│       ├── spawn.ts             # Spawn command
│       ├── pause.ts             # Pause/resume handling
│       ├── logs.ts              # Log writer with intentional blocking I/O
│       └── gamelogic.ts         # CLI input, help text, utilities
└── scripts/
    ├── rabbit.sh                # Docker container lifecycle
    └── multiserver.sh           # Parallel server instances
```

## Lessons Learned

### Message Broker Patterns
- **Direct vs Topic exchanges**: direct exchanges for simple broadcast (pause/resume), topic exchanges with wildcard routing keys (`army_moves.*`, `war.*`) for flexible per-player message filtering
- **Durable vs Transient queues**: war and log queues are durable (survive broker restart), pause and move queues are transient+exclusive (auto-delete when client disconnects) -- matching queue durability to message importance
- **Dead-letter exchanges**: failed messages route to a DLX (`peril_dlx`) instead of being silently dropped, enabling later inspection

### Reliability
- **Publisher confirms**: using `createConfirmChannel()` instead of fire-and-forget, so the publisher knows when RabbitMQ has accepted the message
- **Three-way acknowledgement**: ack (processed), nack+requeue (temporary failure, try again), nack+discard (permanent failure, route to DLX) -- giving consumers fine-grained control over message lifecycle
- **Prefetch limits**: `channel.prefetch(10)` prevents a single fast consumer from hogging all messages, enabling fair distribution across competing consumers

### Serialization Trade-offs
- **JSON** for structured game commands (human-readable, easy to debug)
- **MessagePack** for high-volume game logs (binary, more compact, faster to encode/decode)
- Using generics (`publishJSON<T>`, `subscribeJSON<T>`) to keep the pub/sub layer type-safe regardless of serialization format

### Backpressure and Slow Consumers
- The `writeLog()` function intentionally blocks for 1 second per message to simulate slow I/O
- Combined with prefetch limits and multiple server instances (competing consumers), this demonstrates how RabbitMQ handles backpressure -- slow consumers don't block the broker, and work distributes across available workers
- The `spam` command exists specifically to generate load and observe this behavior

### TypeScript Patterns
- `as const` assertions + mapped types for type-safe enums (`Location`, `UnitRank`) without runtime overhead
- Discriminated unions for `WarResolution` (different shapes per outcome)
- `noUncheckedIndexedAccess` for safer record/map access
- Generic handler callbacks (`handler: (data: T) => AckType`) keeping the pub/sub layer decoupled from game logic
