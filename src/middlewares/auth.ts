import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, TokenPayload } from "../config/jwt.js";

// Extender o tipo Request para incluir o user
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

// Middleware de autenticação
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    // Tentar pegar token do cookie primeiro, depois do header Authorization
    const tokenFromCookie = req.cookies?.access_token;
    const tokenFromHeader = req.headers.authorization?.replace("Bearer ", "");
    const token = tokenFromCookie || tokenFromHeader;

    if (!token) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Token de acesso não fornecido",
      });
    }

    const payload = await verifyAccessToken(token);

    if (!payload) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Token inválido ou expirado",
      });
    }

    // Adicionar usuário ao request
    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Erro ao verificar token",
    });
  }
}

// Middleware para verificar se é admin
export async function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Usuário não autenticado",
    });
  }

  if (req.user.role !== "admin" && req.user.role !== "super_admin") {
    return res.status(403).json({
      error: "Forbidden",
      message: "Acesso negado. Apenas administradores podem acessar este recurso.",
    });
  }

  next();
}
