import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import type { JwtPayload } from "../middleware/auth";

const JWT_SECRET =
  process.env["JWT_SECRET"] ??
  process.env["SESSION_SECRET"] ??
  "dev-secret-change-in-production";

let io: SocketIOServer | null = null;

export function initSocketIO(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ["websocket", "polling"],
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth["token"] as string | undefined;
    if (!token) {
      next(new Error("Missing auth token"));
      return;
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
      (socket as any).userId = decoded.userId;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = (socket as any).userId as string;
    socket.join(`user:${userId}`);

    socket.on("join_match", (matchId: string) => {
      socket.join(`match:${matchId}`);
    });

    socket.on("leave_match", (matchId: string) => {
      socket.leave(`match:${matchId}`);
    });

    socket.on("typing_start", (matchId: string) => {
      socket.to(`match:${matchId}`).emit("typing_start", { userId, matchId });
    });

    socket.on("typing_stop", (matchId: string) => {
      socket.to(`match:${matchId}`).emit("typing_stop", { userId, matchId });
    });

    socket.on("disconnect", () => {});
  });

  return io;
}

export function getIO(): SocketIOServer | null {
  return io;
}

export function emitToUser(userId: string, event: string, data: unknown): void {
  io?.to(`user:${userId}`).emit(event, data);
}

export function emitToMatch(matchId: string, event: string, data: unknown): void {
  io?.to(`match:${matchId}`).emit(event, data);
}
