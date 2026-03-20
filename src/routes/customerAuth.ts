import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "../config/supabase.js";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "../config/jwt.js";
import { customerAuthMiddleware, CustomerRequest } from "../middlewares/customerAuth.js";

const router = Router();

// ============================================
// SCHEMAS DE VALIDAÇÃO
// ============================================

const registerSchema = z.object({
  name: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
  phone: z.string().min(10, "Telefone inválido").max(20),
  cpf: z.string().optional(),
  birth_date: z.string().optional(),
  accepts_marketing: z.boolean().optional().default(false),
});

const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(1, "Senha obrigatória"),
});

const updateProfileSchema = z.object({
  name: z.string().min(3).optional(),
  phone: z.string().min(10).max(20).optional(),
  cpf: z.string().optional(),
  birth_date: z.string().optional(),
  accepts_marketing: z.boolean().optional(),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1, "Senha atual obrigatória"),
  new_password: z.string().min(6, "Nova senha deve ter pelo menos 6 caracteres"),
});

// ============================================
// REGISTRO DE CLIENTE
// ============================================
router.post("/register", async (req: Request, res: Response) => {
  try {
    const validation = registerSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: validation.error.errors[0].message,
      });
    }

    const { name, email, password, phone, cpf, birth_date, accepts_marketing } = validation.data;

    // Verificar se email já existe
    const { data: existingEmail } = await supabaseAdmin
      .from("customers")
      .select("id")
      .eq("email", email.toLowerCase())
      .single();

    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: "Este email já está cadastrado",
      });
    }

    // Verificar se CPF já existe (se fornecido)
    if (cpf) {
      const { data: existingCpf } = await supabaseAdmin
        .from("customers")
        .select("id")
        .eq("cpf", cpf)
        .single();

      if (existingCpf) {
        return res.status(400).json({
          success: false,
          message: "Este CPF já está cadastrado",
        });
      }
    }

    // Hash da senha
    const password_hash = await bcrypt.hash(password, 10);

    // Criar cliente
    const { data: customer, error } = await supabaseAdmin
      .from("customers")
      .insert({
        name,
        email: email.toLowerCase(),
        password_hash,
        phone,
        cpf: cpf || null,
        birth_date: birth_date || null,
        accepts_marketing,
      })
      .select("id, name, email, phone, cpf, birth_date, accepts_marketing, created_at")
      .single();

    if (error) {
      console.error("Error creating customer:", error);
      return res.status(500).json({
        success: false,
        message: "Erro ao criar conta",
      });
    }

    // Gerar tokens
    const accessToken = await generateAccessToken({
      sub: customer.id,
      email: customer.email,
      name: customer.name,
      type: "customer",
    });

    const refreshToken = await generateRefreshToken({
      sub: customer.id,
      type: "customer",
    });

    // Salvar refresh token
    const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
    await supabaseAdmin.from("customer_refresh_tokens").insert({
      customer_id: customer.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 dias
      user_agent: req.headers["user-agent"] || null,
      ip_address: req.ip || null,
    });

    res.status(201).json({
      success: true,
      message: "Conta criada com sucesso",
      data: {
        customer,
        tokens: {
          accessToken,
          refreshToken,
        },
      },
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ============================================
// LOGIN DE CLIENTE
// ============================================
router.post("/login", async (req: Request, res: Response) => {
  try {
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: validation.error.errors[0].message,
      });
    }

    const { email, password } = validation.data;

    // Buscar cliente
    const { data: customer, error } = await supabaseAdmin
      .from("customers")
      .select("*")
      .eq("email", email.toLowerCase())
      .eq("is_active", true)
      .single();

    if (error || !customer) {
      return res.status(401).json({
        success: false,
        message: "Email ou senha inválidos",
      });
    }

    // Verificar senha
    const isValidPassword = await bcrypt.compare(password, customer.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: "Email ou senha inválidos",
      });
    }

    // Atualizar último login
    await supabaseAdmin
      .from("customers")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", customer.id);

    // Gerar tokens
    const accessToken = await generateAccessToken({
      sub: customer.id,
      email: customer.email,
      name: customer.name,
      type: "customer",
    });

    const refreshToken = await generateRefreshToken({
      sub: customer.id,
      type: "customer",
    });

    // Salvar refresh token
    const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
    await supabaseAdmin.from("customer_refresh_tokens").insert({
      customer_id: customer.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      user_agent: req.headers["user-agent"] || null,
      ip_address: req.ip || null,
    });

    // Remover dados sensíveis
    const { password_hash, ...customerData } = customer;

    res.json({
      success: true,
      message: "Login realizado com sucesso",
      data: {
        customer: customerData,
        tokens: {
          accessToken,
          refreshToken,
        },
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ============================================
// REFRESH TOKEN
// ============================================
router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: "Refresh token não fornecido",
      });
    }

    // Verificar token
    const payload = await verifyRefreshToken(refreshToken);
    if (!payload || payload.type !== "customer") {
      return res.status(401).json({
        success: false,
        message: "Refresh token inválido",
      });
    }

    const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");

    // Buscar e validar token no banco
    const { data: storedToken, error: tokenError } = await supabaseAdmin
      .from("customer_refresh_tokens")
      .select("*")
      .eq("token_hash", tokenHash)
      .eq("customer_id", payload.sub)
      .is("revoked_at", null)
      .single();

    if (tokenError || !storedToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token inválido ou revogado",
      });
    }

    // Verificar expiração
    if (new Date(storedToken.expires_at) < new Date()) {
      return res.status(401).json({
        success: false,
        message: "Refresh token expirado",
      });
    }

    // Buscar cliente
    const { data: customer, error: customerError } = await supabaseAdmin
      .from("customers")
      .select("id, name, email, is_active")
      .eq("id", payload.sub)
      .eq("is_active", true)
      .single();

    if (customerError || !customer) {
      return res.status(401).json({
        success: false,
        message: "Conta não encontrada ou inativa",
      });
    }

    // Gerar novos tokens
    const newAccessToken = await generateAccessToken({
      sub: customer.id,
      email: customer.email,
      name: customer.name,
      type: "customer",
    });

    const newRefreshToken = await generateRefreshToken({
      sub: customer.id,
      type: "customer",
    });

    // Salvar novo refresh token
    const newTokenHash = crypto.createHash("sha256").update(newRefreshToken).digest("hex");
    const { data: newToken } = await supabaseAdmin
      .from("customer_refresh_tokens")
      .insert({
        customer_id: customer.id,
        token_hash: newTokenHash,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        user_agent: req.headers["user-agent"] || null,
        ip_address: req.ip || null,
      })
      .select("id")
      .single();

    // Revogar token antigo (rotation)
    await supabaseAdmin
      .from("customer_refresh_tokens")
      .update({
        revoked_at: new Date().toISOString(),
        replaced_by: newToken?.id,
      })
      .eq("id", storedToken.id);

    res.json({
      success: true,
      data: {
        tokens: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
        },
      },
    });
  } catch (error) {
    console.error("Refresh error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ============================================
// LOGOUT
// ============================================
router.post("/logout", customerAuthMiddleware, async (req: CustomerRequest, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
      await supabaseAdmin
        .from("customer_refresh_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("token_hash", tokenHash)
        .eq("customer_id", req.customer!.id);
    }

    res.json({
      success: true,
      message: "Logout realizado com sucesso",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ============================================
// OBTER PERFIL DO CLIENTE
// ============================================
router.get("/me", customerAuthMiddleware, async (req: CustomerRequest, res: Response) => {
  try {
    const { data: customer, error } = await supabaseAdmin
      .from("customers")
      .select("id, name, email, phone, cpf, birth_date, accepts_marketing, created_at, last_login_at")
      .eq("id", req.customer!.id)
      .single();

    if (error || !customer) {
      return res.status(404).json({
        success: false,
        message: "Cliente não encontrado",
      });
    }

    res.json({
      success: true,
      data: customer,
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ============================================
// ATUALIZAR PERFIL
// ============================================
router.put("/me", customerAuthMiddleware, async (req: CustomerRequest, res: Response) => {
  try {
    const validation = updateProfileSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: validation.error.errors[0].message,
      });
    }

    const updateData = validation.data;

    // Se atualizando CPF, verificar se já existe
    if (updateData.cpf) {
      const { data: existingCpf } = await supabaseAdmin
        .from("customers")
        .select("id")
        .eq("cpf", updateData.cpf)
        .neq("id", req.customer!.id)
        .single();

      if (existingCpf) {
        return res.status(400).json({
          success: false,
          message: "Este CPF já está cadastrado",
        });
      }
    }

    const { data: customer, error } = await supabaseAdmin
      .from("customers")
      .update(updateData)
      .eq("id", req.customer!.id)
      .select("id, name, email, phone, cpf, birth_date, accepts_marketing, created_at")
      .single();

    if (error) {
      console.error("Update profile error:", error);
      return res.status(500).json({
        success: false,
        message: "Erro ao atualizar perfil",
      });
    }

    res.json({
      success: true,
      message: "Perfil atualizado com sucesso",
      data: customer,
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ============================================
// ALTERAR SENHA
// ============================================
router.put("/change-password", customerAuthMiddleware, async (req: CustomerRequest, res: Response) => {
  try {
    const validation = changePasswordSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: validation.error.errors[0].message,
      });
    }

    const { current_password, new_password } = validation.data;

    // Buscar senha atual
    const { data: customer, error } = await supabaseAdmin
      .from("customers")
      .select("password_hash")
      .eq("id", req.customer!.id)
      .single();

    if (error || !customer) {
      return res.status(404).json({
        success: false,
        message: "Cliente não encontrado",
      });
    }

    // Verificar senha atual
    const isValidPassword = await bcrypt.compare(current_password, customer.password_hash);
    if (!isValidPassword) {
      return res.status(400).json({
        success: false,
        message: "Senha atual incorreta",
      });
    }

    // Hash da nova senha
    const new_password_hash = await bcrypt.hash(new_password, 10);

    // Atualizar senha
    await supabaseAdmin
      .from("customers")
      .update({ password_hash: new_password_hash })
      .eq("id", req.customer!.id);

    // Revogar todos os refresh tokens (força re-login em outros dispositivos)
    await supabaseAdmin
      .from("customer_refresh_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("customer_id", req.customer!.id)
      .is("revoked_at", null);

    res.json({
      success: true,
      message: "Senha alterada com sucesso",
    });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

export default router;
