import { Router, Request, Response } from "express";
import { z } from "zod";
import supabaseAdmin from "../config/supabase.js";
import { authMiddleware, adminMiddleware } from "../middlewares/auth.js";
import { getOrSet, invalidateProducts, CACHE_KEYS, CACHE_TTL } from "../utils/cache.js";
import { searchLimiter } from "../middlewares/rateLimit.js";

const router = Router();

// Schema de validação para produto
const productSchema = z.object({
  name: z.string().min(2, "Nome deve ter no mínimo 2 caracteres"),
  slug: z.string().min(2, "Slug deve ter no mínimo 2 caracteres"),
  description: z.string().optional(),
  short_description: z.string().optional(),
  price: z.number().positive("Preço deve ser positivo"),
  original_price: z.number().positive().optional(),
  category_id: z.string().uuid("ID da categoria inválido"),
  images: z.array(z.string().url()).optional(),
  stock_quantity: z.number().int().min(0).default(0),
  sku: z.string().optional(),
  is_active: z.boolean().default(true),
  is_featured: z.boolean().default(false),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.any()).optional(),
});

const productUpdateSchema = productSchema.partial();

// GET /api/products - Listar produtos (público) - com cache
router.get("/", async (req: Request, res: Response) => {
  try {
    const {
      page = "1",
      limit = "20",
      category,
      search,
      featured,
      sort = "created_at",
      order = "desc",
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    // Gerar chave de cache unica para esta query
    const cacheKey = search 
      ? null // Nao cachear buscas (muito dinamico)
      : `products_${category || 'all'}_${featured || 'all'}_${sort}_${order}_p${pageNum}_l${limitNum}`;

    const fetchProducts = async () => {
      let query = supabaseAdmin
        .from("products")
        .select(`
          *,
          category:categories(id, name, slug)
        `, { count: "exact" })
        .eq("is_active", true);

      // Filtros
      if (category) {
        query = query.eq("category_id", category);
      }

      if (search) {
        query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
      }

      if (featured === "true") {
        query = query.eq("is_featured", true);
      }

      // Ordenação
      const validSortFields = ["created_at", "price", "name", "stock_quantity"];
      const sortField = validSortFields.includes(sort as string) ? sort as string : "created_at";
      const sortOrder = order === "asc" ? true : false;

      query = query.order(sortField, { ascending: sortOrder });

      // Paginação
      query = query.range(offset, offset + limitNum - 1);

      const { data: products, error, count } = await query;

      if (error) {
        throw error;
      }

      return {
        success: true,
        data: products,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limitNum),
        },
      };
    };

    // Se tem search, nao usa cache
    if (!cacheKey) {
      const result = await fetchProducts();
      return res.json(result);
    }

    // Usa cache para listagens normais
    const result = await getOrSet(cacheKey, fetchProducts, CACHE_TTL.PRODUCTS);
    return res.json(result);

  } catch (error) {
    console.error("Erro ao listar produtos:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao listar produtos",
    });
  }
});

// GET /api/products/:id - Buscar produto por ID (público)
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data: product, error } = await supabaseAdmin
      .from("products")
      .select(`
        *,
        category:categories(id, name, slug)
      `)
      .eq("id", id)
      .eq("is_active", true)
      .single();

    if (error || !product) {
      return res.status(404).json({
        error: "Not Found",
        message: "Produto não encontrado",
      });
    }

    return res.json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("Erro ao buscar produto:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao buscar produto",
    });
  }
});

// GET /api/products/slug/:slug - Buscar produto por slug (público) - com cache
router.get("/slug/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    const result = await getOrSet(
      CACHE_KEYS.PRODUCT_BY_SLUG(slug),
      async () => {
        const { data: product, error } = await supabaseAdmin
          .from("products")
          .select(`
            *,
            category:categories(id, name, slug)
          `)
          .eq("slug", slug)
          .eq("is_active", true)
          .single();

        if (error || !product) {
          return null;
        }

        return product;
      },
      CACHE_TTL.PRODUCT_DETAIL
    );

    if (!result) {
      return res.status(404).json({
        error: "Not Found",
        message: "Produto não encontrado",
      });
    }

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Erro ao buscar produto:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao buscar produto",
    });
  }
});

// ========== ROTAS ADMIN (protegidas) ==========

// GET /api/products/admin/all - Listar todos produtos (admin)
router.get("/admin/all", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const {
      page = "1",
      limit = "20",
      category,
      search,
      status,
      sort = "created_at",
      order = "desc",
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    let query = supabaseAdmin
      .from("products")
      .select(`
        *,
        category:categories(id, name, slug)
      `, { count: "exact" });

    // Filtros
    if (category) {
      query = query.eq("category_id", category);
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);
    }

    if (status === "active") {
      query = query.eq("is_active", true);
    } else if (status === "inactive") {
      query = query.eq("is_active", false);
    }

    // Ordenação
    const validSortFields = ["created_at", "price", "name", "stock_quantity", "updated_at"];
    const sortField = validSortFields.includes(sort as string) ? sort as string : "created_at";
    const sortOrder = order === "asc" ? true : false;

    query = query.order(sortField, { ascending: sortOrder });

    // Paginação
    query = query.range(offset, offset + limitNum - 1);

    const { data: products, error, count } = await query;

    if (error) {
      throw error;
    }

    return res.json({
      success: true,
      data: products,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
    });
  } catch (error) {
    console.error("Erro ao listar produtos (admin):", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao listar produtos",
    });
  }
});

// GET /api/products/admin/:id - Buscar produto por ID (admin)
router.get("/admin/:id", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data: product, error } = await supabaseAdmin
      .from("products")
      .select(`
        *,
        category:categories(id, name, slug)
      `)
      .eq("id", id)
      .single();

    if (error || !product) {
      return res.status(404).json({
        error: "Not Found",
        message: "Produto não encontrado",
      });
    }

    return res.json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("Erro ao buscar produto (admin):", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao buscar produto",
    });
  }
});

// POST /api/products/admin - Criar produto (admin)
router.post("/admin", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const validation = productSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: "Validation Error",
        message: validation.error.errors[0].message,
        errors: validation.error.errors,
      });
    }

    const productData = validation.data;

    // Verificar se slug já existe
    const { data: existingProduct } = await supabaseAdmin
      .from("products")
      .select("id")
      .eq("slug", productData.slug)
      .single();

    if (existingProduct) {
      return res.status(400).json({
        error: "Validation Error",
        message: "Já existe um produto com este slug",
      });
    }

    // Criar produto
    const { data: product, error } = await supabaseAdmin
      .from("products")
      .insert(productData)
      .select(`
        *,
        category:categories(id, name, slug)
      `)
      .single();

    if (error) {
      throw error;
    }

    // Invalidar cache de produtos
    invalidateProducts();

    return res.status(201).json({
      success: true,
      message: "Produto criado com sucesso",
      data: product,
    });
  } catch (error) {
    console.error("Erro ao criar produto:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao criar produto",
    });
  }
});

// PUT /api/products/admin/:id - Atualizar produto (admin)
router.put("/admin/:id", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const validation = productUpdateSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: "Validation Error",
        message: validation.error.errors[0].message,
        errors: validation.error.errors,
      });
    }

    const productData = validation.data;

    // Verificar se produto existe
    const { data: existingProduct, error: findError } = await supabaseAdmin
      .from("products")
      .select("id")
      .eq("id", id)
      .single();

    if (findError || !existingProduct) {
      return res.status(404).json({
        error: "Not Found",
        message: "Produto não encontrado",
      });
    }

    // Se está atualizando slug, verificar se já existe
    if (productData.slug) {
      const { data: slugCheck } = await supabaseAdmin
        .from("products")
        .select("id")
        .eq("slug", productData.slug)
        .neq("id", id)
        .single();

      if (slugCheck) {
        return res.status(400).json({
          error: "Validation Error",
          message: "Já existe um produto com este slug",
        });
      }
    }

    // Atualizar produto
    const { data: product, error } = await supabaseAdmin
      .from("products")
      .update({
        ...productData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(`
        *,
        category:categories(id, name, slug)
      `)
      .single();

    if (error) {
      throw error;
    }

    // Invalidar cache de produtos
    invalidateProducts();

    return res.json({
      success: true,
      message: "Produto atualizado com sucesso",
      data: product,
    });
  } catch (error) {
    console.error("Erro ao atualizar produto:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao atualizar produto",
    });
  }
});

// DELETE /api/products/admin/:id - Excluir produto (admin)
router.delete("/admin/:id", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verificar se produto existe
    const { data: existingProduct, error: findError } = await supabaseAdmin
      .from("products")
      .select("id, name")
      .eq("id", id)
      .single();

    if (findError || !existingProduct) {
      return res.status(404).json({
        error: "Not Found",
        message: "Produto não encontrado",
      });
    }

    // Excluir produto (ou soft delete se preferir)
    const { error } = await supabaseAdmin
      .from("products")
      .delete()
      .eq("id", id);

    if (error) {
      throw error;
    }

    // Invalidar cache de produtos
    invalidateProducts();

    return res.json({
      success: true,
      message: `Produto "${existingProduct.name}" excluído com sucesso`,
    });
  } catch (error) {
    console.error("Erro ao excluir produto:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao excluir produto",
    });
  }
});

export default router;
