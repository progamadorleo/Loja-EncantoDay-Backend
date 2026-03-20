import { Router, Response } from "express";
import { supabaseAdmin } from "../config/supabase.js";
import { customerAuthMiddleware, CustomerRequest } from "../middlewares/customerAuth.js";
import { optionalCustomerAuthMiddleware } from "../middlewares/customerAuth.js";

const router = Router();

// ============================================
// LISTAR FAVORITOS DO CLIENTE
// ============================================
router.get("/", customerAuthMiddleware, async (req: CustomerRequest, res: Response) => {
  try {
    const { data: favorites, error } = await supabaseAdmin
      .from("customer_favorites")
      .select(`
        id,
        created_at,
        product:products (
          id,
          name,
          slug,
          price,
          original_price,
          images,
          is_active,
          stock_quantity,
          category:categories (
            id,
            name,
            slug
          )
        )
      `)
      .eq("customer_id", req.customer!.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Get favorites error:", error);
      return res.status(500).json({
        success: false,
        message: "Erro ao buscar favoritos",
      });
    }

    // Filtrar apenas produtos ativos
    const activeFavorites = favorites?.filter(
      (f) => f.product && (f.product as any).is_active
    ) || [];

    res.json({
      success: true,
      data: activeFavorites,
    });
  } catch (error) {
    console.error("Get favorites error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ============================================
// VERIFICAR SE PRODUTO ESTÁ NOS FAVORITOS
// ============================================
router.get("/check/:productId", customerAuthMiddleware, async (req: CustomerRequest, res: Response) => {
  try {
    const { productId } = req.params;

    const { data: favorite, error } = await supabaseAdmin
      .from("customer_favorites")
      .select("id")
      .eq("customer_id", req.customer!.id)
      .eq("product_id", productId)
      .single();

    res.json({
      success: true,
      data: {
        isFavorite: !!favorite,
        favoriteId: favorite?.id || null,
      },
    });
  } catch (error) {
    console.error("Check favorite error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ============================================
// LISTAR IDS DOS PRODUTOS FAVORITOS (para marcar no grid)
// ============================================
router.get("/ids", customerAuthMiddleware, async (req: CustomerRequest, res: Response) => {
  try {
    const { data: favorites, error } = await supabaseAdmin
      .from("customer_favorites")
      .select("product_id")
      .eq("customer_id", req.customer!.id);

    if (error) {
      console.error("Get favorite ids error:", error);
      return res.status(500).json({
        success: false,
        message: "Erro ao buscar favoritos",
      });
    }

    const productIds = favorites?.map((f) => f.product_id) || [];

    res.json({
      success: true,
      data: productIds,
    });
  } catch (error) {
    console.error("Get favorite ids error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ============================================
// ADICIONAR PRODUTO AOS FAVORITOS
// ============================================
router.post("/:productId", customerAuthMiddleware, async (req: CustomerRequest, res: Response) => {
  try {
    const { productId } = req.params;

    // Verificar se produto existe e está ativo
    const { data: product, error: productError } = await supabaseAdmin
      .from("products")
      .select("id, name")
      .eq("id", productId)
      .eq("is_active", true)
      .single();

    if (productError || !product) {
      return res.status(404).json({
        success: false,
        message: "Produto não encontrado",
      });
    }

    // Verificar se já está nos favoritos
    const { data: existing } = await supabaseAdmin
      .from("customer_favorites")
      .select("id")
      .eq("customer_id", req.customer!.id)
      .eq("product_id", productId)
      .single();

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Produto já está nos favoritos",
      });
    }

    // Verificar limite de favoritos (máximo 50)
    const { count } = await supabaseAdmin
      .from("customer_favorites")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", req.customer!.id);

    if (count && count >= 50) {
      return res.status(400).json({
        success: false,
        message: "Você atingiu o limite de 50 produtos favoritos",
      });
    }

    // Adicionar aos favoritos
    const { data: favorite, error } = await supabaseAdmin
      .from("customer_favorites")
      .insert({
        customer_id: req.customer!.id,
        product_id: productId,
      })
      .select("id, created_at")
      .single();

    if (error) {
      console.error("Add favorite error:", error);
      return res.status(500).json({
        success: false,
        message: "Erro ao adicionar favorito",
      });
    }

    res.status(201).json({
      success: true,
      message: `${product.name} adicionado aos favoritos`,
      data: favorite,
    });
  } catch (error) {
    console.error("Add favorite error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ============================================
// REMOVER PRODUTO DOS FAVORITOS
// ============================================
router.delete("/:productId", customerAuthMiddleware, async (req: CustomerRequest, res: Response) => {
  try {
    const { productId } = req.params;

    const { error } = await supabaseAdmin
      .from("customer_favorites")
      .delete()
      .eq("customer_id", req.customer!.id)
      .eq("product_id", productId);

    if (error) {
      console.error("Remove favorite error:", error);
      return res.status(500).json({
        success: false,
        message: "Erro ao remover favorito",
      });
    }

    res.json({
      success: true,
      message: "Produto removido dos favoritos",
    });
  } catch (error) {
    console.error("Remove favorite error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ============================================
// TOGGLE FAVORITO (adicionar ou remover)
// ============================================
router.post("/:productId/toggle", customerAuthMiddleware, async (req: CustomerRequest, res: Response) => {
  try {
    const { productId } = req.params;

    // Verificar se produto existe e está ativo
    const { data: product, error: productError } = await supabaseAdmin
      .from("products")
      .select("id, name")
      .eq("id", productId)
      .eq("is_active", true)
      .single();

    if (productError || !product) {
      return res.status(404).json({
        success: false,
        message: "Produto não encontrado",
      });
    }

    // Verificar se já está nos favoritos
    const { data: existing } = await supabaseAdmin
      .from("customer_favorites")
      .select("id")
      .eq("customer_id", req.customer!.id)
      .eq("product_id", productId)
      .single();

    if (existing) {
      // Remover dos favoritos
      await supabaseAdmin
        .from("customer_favorites")
        .delete()
        .eq("id", existing.id);

      return res.json({
        success: true,
        message: "Produto removido dos favoritos",
        data: {
          isFavorite: false,
        },
      });
    } else {
      // Verificar limite
      const { count } = await supabaseAdmin
        .from("customer_favorites")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", req.customer!.id);

      if (count && count >= 50) {
        return res.status(400).json({
          success: false,
          message: "Você atingiu o limite de 50 produtos favoritos",
        });
      }

      // Adicionar aos favoritos
      const { data: favorite } = await supabaseAdmin
        .from("customer_favorites")
        .insert({
          customer_id: req.customer!.id,
          product_id: productId,
        })
        .select("id")
        .single();

      return res.json({
        success: true,
        message: `${product.name} adicionado aos favoritos`,
        data: {
          isFavorite: true,
          favoriteId: favorite?.id,
        },
      });
    }
  } catch (error) {
    console.error("Toggle favorite error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ============================================
// CONTAR FAVORITOS
// ============================================
router.get("/count", customerAuthMiddleware, async (req: CustomerRequest, res: Response) => {
  try {
    const { count, error } = await supabaseAdmin
      .from("customer_favorites")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", req.customer!.id);

    if (error) {
      console.error("Count favorites error:", error);
      return res.status(500).json({
        success: false,
        message: "Erro ao contar favoritos",
      });
    }

    res.json({
      success: true,
      data: {
        count: count || 0,
      },
    });
  } catch (error) {
    console.error("Count favorites error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

export default router;
