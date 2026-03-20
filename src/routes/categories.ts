import { Router, Request, Response } from "express";
import { z } from "zod";
import supabaseAdmin from "../config/supabase.js";
import { authMiddleware, adminMiddleware } from "../middlewares/auth.js";

const router = Router();

// Schema de validação para categoria
const categorySchema = z.object({
  name: z.string().min(2, "Nome deve ter no mínimo 2 caracteres"),
  slug: z.string().min(2, "Slug deve ter no mínimo 2 caracteres"),
  description: z.string().optional(),
  image_url: z.string().url().optional().nullable(),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

const categoryUpdateSchema = categorySchema.partial();

// GET /api/categories - Listar categorias ativas (público)
router.get("/", async (req: Request, res: Response) => {
  try {
    const { data: categories, error } = await supabaseAdmin
      .from("categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) {
      throw error;
    }

    return res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    console.error("Erro ao listar categorias:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao listar categorias",
    });
  }
});

// GET /api/categories/:id - Buscar categoria por ID (público)
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data: category, error } = await supabaseAdmin
      .from("categories")
      .select("*")
      .eq("id", id)
      .eq("is_active", true)
      .single();

    if (error || !category) {
      return res.status(404).json({
        error: "Not Found",
        message: "Categoria não encontrada",
      });
    }

    return res.json({
      success: true,
      data: category,
    });
  } catch (error) {
    console.error("Erro ao buscar categoria:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao buscar categoria",
    });
  }
});

// GET /api/categories/slug/:slug - Buscar categoria por slug (público)
router.get("/slug/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    const { data: category, error } = await supabaseAdmin
      .from("categories")
      .select("*")
      .eq("slug", slug)
      .eq("is_active", true)
      .single();

    if (error || !category) {
      return res.status(404).json({
        error: "Not Found",
        message: "Categoria não encontrada",
      });
    }

    return res.json({
      success: true,
      data: category,
    });
  } catch (error) {
    console.error("Erro ao buscar categoria:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao buscar categoria",
    });
  }
});

// ========== ROTAS ADMIN (protegidas) ==========

// GET /api/categories/admin/all - Listar todas categorias (admin)
router.get("/admin/all", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { data: categories, error } = await supabaseAdmin
      .from("categories")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error) {
      throw error;
    }

    return res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    console.error("Erro ao listar categorias (admin):", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao listar categorias",
    });
  }
});

// GET /api/categories/admin/:id - Buscar categoria por ID (admin)
router.get("/admin/:id", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data: category, error } = await supabaseAdmin
      .from("categories")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !category) {
      return res.status(404).json({
        error: "Not Found",
        message: "Categoria não encontrada",
      });
    }

    return res.json({
      success: true,
      data: category,
    });
  } catch (error) {
    console.error("Erro ao buscar categoria (admin):", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao buscar categoria",
    });
  }
});

// POST /api/categories/admin - Criar categoria (admin)
router.post("/admin", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const validation = categorySchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: "Validation Error",
        message: validation.error.errors[0].message,
        errors: validation.error.errors,
      });
    }

    const categoryData = validation.data;

    // Verificar se slug já existe
    const { data: existingCategory } = await supabaseAdmin
      .from("categories")
      .select("id")
      .eq("slug", categoryData.slug)
      .single();

    if (existingCategory) {
      return res.status(400).json({
        error: "Validation Error",
        message: "Já existe uma categoria com este slug",
      });
    }

    // Criar categoria
    const { data: category, error } = await supabaseAdmin
      .from("categories")
      .insert(categoryData)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return res.status(201).json({
      success: true,
      message: "Categoria criada com sucesso",
      data: category,
    });
  } catch (error) {
    console.error("Erro ao criar categoria:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao criar categoria",
    });
  }
});

// PUT /api/categories/admin/:id - Atualizar categoria (admin)
router.put("/admin/:id", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const validation = categoryUpdateSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: "Validation Error",
        message: validation.error.errors[0].message,
        errors: validation.error.errors,
      });
    }

    const categoryData = validation.data;

    // Verificar se categoria existe
    const { data: existingCategory, error: findError } = await supabaseAdmin
      .from("categories")
      .select("id")
      .eq("id", id)
      .single();

    if (findError || !existingCategory) {
      return res.status(404).json({
        error: "Not Found",
        message: "Categoria não encontrada",
      });
    }

    // Se está atualizando slug, verificar se já existe
    if (categoryData.slug) {
      const { data: slugCheck } = await supabaseAdmin
        .from("categories")
        .select("id")
        .eq("slug", categoryData.slug)
        .neq("id", id)
        .single();

      if (slugCheck) {
        return res.status(400).json({
          error: "Validation Error",
          message: "Já existe uma categoria com este slug",
        });
      }
    }

    // Atualizar categoria
    const { data: category, error } = await supabaseAdmin
      .from("categories")
      .update({
        ...categoryData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return res.json({
      success: true,
      message: "Categoria atualizada com sucesso",
      data: category,
    });
  } catch (error) {
    console.error("Erro ao atualizar categoria:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao atualizar categoria",
    });
  }
});

// DELETE /api/categories/admin/:id - Excluir categoria (admin)
router.delete("/admin/:id", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verificar se categoria existe
    const { data: existingCategory, error: findError } = await supabaseAdmin
      .from("categories")
      .select("id, name")
      .eq("id", id)
      .single();

    if (findError || !existingCategory) {
      return res.status(404).json({
        error: "Not Found",
        message: "Categoria não encontrada",
      });
    }

    // Verificar se existem produtos usando esta categoria
    const { count: productCount } = await supabaseAdmin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("category_id", id);

    if (productCount && productCount > 0) {
      return res.status(400).json({
        error: "Validation Error",
        message: `Não é possível excluir. Existem ${productCount} produto(s) usando esta categoria.`,
      });
    }

    // Excluir categoria
    const { error } = await supabaseAdmin
      .from("categories")
      .delete()
      .eq("id", id);

    if (error) {
      throw error;
    }

    return res.json({
      success: true,
      message: `Categoria "${existingCategory.name}" excluída com sucesso`,
    });
  } catch (error) {
    console.error("Erro ao excluir categoria:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao excluir categoria",
    });
  }
});

export default router;
