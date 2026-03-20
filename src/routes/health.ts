import { Router, Request, Response } from "express";

const router = Router();

interface HealthResponse {
  status: "healthy" | "unhealthy";
  timestamp: string;
  uptime: number;
  environment: string;
  version: string;
  services: {
    database: "connected" | "disconnected" | "not_configured";
    cache: "connected" | "disconnected" | "not_configured";
  };
}

/**
 * @route   GET /api/health
 * @desc    Verifica o status de saúde da API
 * @access  Public
 */
router.get("/health", (req: Request, res: Response) => {
  const healthcheck: HealthResponse = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
    version: "1.0.0",
    services: {
      database: "not_configured", // Será atualizado quando conectar ao banco
      cache: "not_configured", // Será atualizado quando conectar ao Redis
    },
  };

  res.status(200).json(healthcheck);
});

/**
 * @route   GET /api/health/ping
 * @desc    Resposta simples para verificar se a API está online
 * @access  Public
 */
router.get("/health/ping", (req: Request, res: Response) => {
  res.status(200).json({ message: "pong", timestamp: Date.now() });
});

export default router;
