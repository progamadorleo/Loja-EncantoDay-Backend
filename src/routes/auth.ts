import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import supabaseAdmin from "../config/supabase.js";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  COOKIE_OPTIONS,
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from "../config/jwt.js";
import { authMiddleware } from "../middlewares/auth.js";

const router = Router();

// Schema de validação para login
const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "Senha deve ter no mínimo 6 caracteres"),
});

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response) => {
  try {
    // Validar input
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: "Validation Error",
        message: validation.error.errors[0].message,
      });
    }

    const { email, password } = validation.data;

    // Buscar usuário no banco
    const { data: user, error } = await supabaseAdmin
      .from("admin_users")
      .select("*")
      .eq("email", email.toLowerCase())
      .eq("is_active", true)
      .single();

    if (error || !user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Email ou senha inválidos",
      });
    }

    // Verificar senha
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Email ou senha inválidos",
      });
    }

    // Gerar tokens
    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = await generateAccessToken(tokenPayload);
    const refreshToken = await generateRefreshToken(tokenPayload);

    // Salvar refresh token no banco (com hash para segurança)
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 dias

    await supabaseAdmin.from("refresh_tokens").insert({
      user_id: user.id,
      token_hash: refreshTokenHash,
      expires_at: expiresAt.toISOString(),
    });

    // Atualizar last_login do usuário
    await supabaseAdmin
      .from("admin_users")
      .update({ last_login: new Date().toISOString() })
      .eq("id", user.id);

    // Setar cookies HttpOnly
    res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
      ...COOKIE_OPTIONS,
      maxAge: 15 * 60 * 1000, // 15 minutos
    });

    res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      ...COOKIE_OPTIONS,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
    });

    return res.json({
      success: true,
      message: "Login realizado com sucesso",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      // Também retornar tokens para clientes que não usam cookies
      tokens: {
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    console.error("Erro no login:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao processar login",
    });
  }
});

// POST /api/auth/refresh
router.post("/refresh", async (req: Request, res: Response) => {
  try {
    // Pegar refresh token do cookie ou body
    const refreshToken = req.cookies?.refresh_token || req.body?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Refresh token não fornecido",
      });
    }

    // Verificar refresh token
    const payload = await verifyRefreshToken(refreshToken);
    if (!payload) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Refresh token inválido ou expirado",
      });
    }

    // Buscar tokens do usuário no banco
    const { data: storedTokens, error: tokensError } = await supabaseAdmin
      .from("refresh_tokens")
      .select("*")
      .eq("user_id", payload.userId)
      .eq("is_revoked", false)
      .gte("expires_at", new Date().toISOString());

    if (tokensError || !storedTokens?.length) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Sessão não encontrada",
      });
    }

    // Verificar se o token corresponde a algum token armazenado
    let validToken = null;
    for (const storedToken of storedTokens) {
      const isMatch = await bcrypt.compare(refreshToken, storedToken.token_hash);
      if (isMatch) {
        validToken = storedToken;
        break;
      }
    }

    if (!validToken) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Refresh token inválido",
      });
    }

    // Revogar o token antigo (rotation)
    await supabaseAdmin
      .from("refresh_tokens")
      .update({ is_revoked: true })
      .eq("id", validToken.id);

    // Buscar usuário atualizado
    const { data: user, error: userError } = await supabaseAdmin
      .from("admin_users")
      .select("*")
      .eq("id", payload.userId)
      .eq("is_active", true)
      .single();

    if (userError || !user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Usuário não encontrado ou inativo",
      });
    }

    // Gerar novos tokens
    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const newAccessToken = await generateAccessToken(tokenPayload);
    const newRefreshToken = await generateRefreshToken(tokenPayload);

    // Salvar novo refresh token
    const newRefreshTokenHash = await bcrypt.hash(newRefreshToken, 10);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await supabaseAdmin.from("refresh_tokens").insert({
      user_id: user.id,
      token_hash: newRefreshTokenHash,
      expires_at: expiresAt.toISOString(),
    });

    // Setar novos cookies
    res.cookie(ACCESS_TOKEN_COOKIE, newAccessToken, {
      ...COOKIE_OPTIONS,
      maxAge: 15 * 60 * 1000,
    });

    res.cookie(REFRESH_TOKEN_COOKIE, newRefreshToken, {
      ...COOKIE_OPTIONS,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({
      success: true,
      message: "Tokens renovados com sucesso",
      tokens: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (error) {
    console.error("Erro no refresh:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao renovar tokens",
    });
  }
});

// POST /api/auth/logout
router.post("/logout", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (userId) {
      // Revogar todos os refresh tokens do usuário
      await supabaseAdmin
        .from("refresh_tokens")
        .update({ is_revoked: true })
        .eq("user_id", userId);
    }

    // Limpar cookies
    res.clearCookie(ACCESS_TOKEN_COOKIE, COOKIE_OPTIONS);
    res.clearCookie(REFRESH_TOKEN_COOKIE, COOKIE_OPTIONS);

    return res.json({
      success: true,
      message: "Logout realizado com sucesso",
    });
  } catch (error) {
    console.error("Erro no logout:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao processar logout",
    });
  }
});

// GET /api/auth/me
router.get("/me", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;

    const { data: user, error } = await supabaseAdmin
      .from("admin_users")
      .select("id, email, name, role, created_at, last_login")
      .eq("id", userId)
      .eq("is_active", true)
      .single();

    if (error || !user) {
      return res.status(404).json({
        error: "Not Found",
        message: "Usuário não encontrado",
      });
    }

    return res.json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Erro ao buscar usuário:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao buscar dados do usuário",
    });
  }
});

export default router;
