import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../config/supabase.js";
import { authMiddleware } from "../middlewares/auth.js";

const router = Router();

// Schema de validação
const bannerSchema = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(200).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  highlight: z.string().max(200).optional().nullable(),
  disclaimer: z.string().optional().nullable(),
  price_label: z.string().max(100).optional().nullable(),
  price_value: z.string().max(50).optional().nullable(),
  price_cents: z.string().max(20).optional().nullable(),
  installments: z.string().max(100).optional().nullable(),
  full_price: z.string().max(100).optional().nullable(),
  bg_color: z.string().optional().nullable(),
  text_color: z.string().max(200).optional().nullable(),
  accent_color: z.string().max(200).optional().nullable(),
  image_url: z.string().optional().nullable(),
  images: z.array(z.string()).optional().nullable(),
  link_url: z.string().max(500).optional().nullable(),
  link_text: z.string().max(100).optional().nullable(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  starts_at: z.string().optional().nullable(),
  ends_at: z.string().optional().nullable(),
});

// ============================================
// ROTAS PÚBLICAS
// ============================================

// GET /api/banners - Listar banners ativos (público)
router.get("/", async (req: Request, res: Response) => {
  try {
    const now = new Date().toISOString();
    
    const { data, error } = await supabaseAdmin
      .from("banners")
      .select("*")
      .eq("is_active", true)
      .or(`starts_at.is.null,starts_at.lte.${now}`)
      .or(`ends_at.is.null,ends_at.gte.${now}`)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Error fetching banners:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao buscar banners",
    });
  }
});

// GET /api/banners/:id - Obter banner por ID (público)
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from("banners")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return res.status(404).json({
        error: "Not Found",
        message: "Banner não encontrado",
      });
    }

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Error fetching banner:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao buscar banner",
    });
  }
});

// ============================================
// ROTAS ADMIN (protegidas)
// ============================================

// GET /api/banners/admin/all - Listar todos banners (admin)
router.get("/admin/all", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("banners")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error) throw error;

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Error fetching all banners:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao buscar banners",
    });
  }
});

// POST /api/banners/admin - Criar banner (admin)
router.post("/admin", authMiddleware, async (req: Request, res: Response) => {
  try {
    const validation = bannerSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        error: "Validation Error",
        message: "Dados inválidos",
        details: validation.error.errors,
      });
    }

    const bannerData = {
      ...validation.data,
      created_by: req.user?.id,
    };

    const { data, error } = await supabaseAdmin
      .from("banners")
      .insert(bannerData)
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      message: "Banner criado com sucesso",
      data,
    });
  } catch (error) {
    console.error("Error creating banner:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao criar banner",
    });
  }
});

// PUT /api/banners/admin/:id - Atualizar banner (admin)
router.put("/admin/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const validation = bannerSchema.partial().safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        error: "Validation Error",
        message: "Dados inválidos",
        details: validation.error.errors,
      });
    }

    // Verificar se banner existe
    const { data: existing } = await supabaseAdmin
      .from("banners")
      .select("id")
      .eq("id", id)
      .single();

    if (!existing) {
      return res.status(404).json({
        error: "Not Found",
        message: "Banner não encontrado",
      });
    }

    const { data, error } = await supabaseAdmin
      .from("banners")
      .update(validation.data)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      message: "Banner atualizado com sucesso",
      data,
    });
  } catch (error) {
    console.error("Error updating banner:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao atualizar banner",
    });
  }
});

// PATCH /api/banners/admin/:id/toggle - Alternar status (admin)
router.patch("/admin/:id/toggle", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Buscar banner atual
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("banners")
      .select("is_active")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({
        error: "Not Found",
        message: "Banner não encontrado",
      });
    }

    const { data, error } = await supabaseAdmin
      .from("banners")
      .update({ is_active: !existing.is_active })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      message: `Banner ${data.is_active ? "ativado" : "desativado"} com sucesso`,
      data,
    });
  } catch (error) {
    console.error("Error toggling banner:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao alternar status do banner",
    });
  }
});

// PUT /api/banners/admin/reorder - Reordenar banners (admin)
router.put("/admin/reorder", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { orders } = req.body;

    if (!Array.isArray(orders)) {
      return res.status(400).json({
        error: "Validation Error",
        message: "Formato inválido. Esperado: { orders: [{ id, sort_order }] }",
      });
    }

    // Atualizar cada banner
    for (const item of orders) {
      await supabaseAdmin
        .from("banners")
        .update({ sort_order: item.sort_order })
        .eq("id", item.id);
    }

    return res.json({
      success: true,
      message: "Ordem atualizada com sucesso",
    });
  } catch (error) {
    console.error("Error reordering banners:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao reordenar banners",
    });
  }
});

// DELETE /api/banners/admin/:id - Deletar banner (admin)
router.delete("/admin/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from("banners")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return res.json({
      success: true,
      message: "Banner excluído com sucesso",
    });
  } catch (error) {
    console.error("Error deleting banner:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao excluir banner",
    });
  }
});

export default router;
