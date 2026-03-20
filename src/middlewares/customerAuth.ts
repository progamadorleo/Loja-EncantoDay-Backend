import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../config/jwt.js";

export interface CustomerRequest extends Request {
  customer?: {
    id: string;
    email: string;
    name: string;
  };
}

/**
 * Middleware para autenticação de clientes
 * Verifica o token JWT e adiciona dados do cliente ao request
 */
export async function customerAuthMiddleware(
  req: CustomerRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Token não fornecido",
      });
    }

    const token = authHeader.split(" ")[1];
    const payload = await verifyAccessToken(token);

    if (!payload || payload.type !== "customer") {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Token inválido",
      });
    }

    req.customer = {
      id: payload.sub as string,
      email: payload.email as string,
      name: payload.name as string,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Token inválido ou expirado",
    });
  }
}

/**
 * Middleware opcional - não bloqueia se não tiver token
 * Útil para rotas que funcionam com ou sem autenticação
 */
export async function optionalCustomerAuthMiddleware(
  req: CustomerRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const payload = await verifyAccessToken(token);

      if (payload && payload.type === "customer") {
        req.customer = {
          id: payload.sub as string,
          email: payload.email as string,
          name: payload.name as string,
        };
      }
    }

    next();
  } catch {
    // Token inválido, mas não bloqueia - continua sem autenticação
    next();
  }
}
