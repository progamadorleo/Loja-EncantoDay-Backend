import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../config/supabase.js";
import { optionalCustomerAuthMiddleware, CustomerRequest } from "../middlewares/customerAuth.js";

const router = Router();

// Interfaces
interface CartItem {
  id: string;
  cart_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  created_at: string;
  updated_at: string;
  product?: {
    id: string;
    name: string;
    slug: string;
    price: number;
    original_price?: number;
    images: string[];
    stock_quantity: number;
    is_active: boolean;
  };
}

interface Cart {
  id: string;
  customer_id?: string;
  session_id?: string;
  status: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  items: CartItem[];
}

// Schema de validação
const addToCartSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(99).default(1),
});

const updateQuantitySchema = z.object({
  quantity: z.number().int().min(1).max(99),
});

// Helper para gerar session_id
function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

// Helper para buscar ou criar carrinho
async function getOrCreateCart(customerId?: string, sessionId?: string): Promise<Cart | null> {
  // Se tem customer_id, busca carrinho do cliente
  if (customerId) {
    const { data: existingCart } = await supabaseAdmin
      .from("carts")
      .select("*")
      .eq("customer_id", customerId)
      .eq("status", "active")
      .single();

    if (existingCart) {
      return existingCart as Cart;
    }

    // Criar novo carrinho para o cliente
    const { data: newCart, error } = await supabaseAdmin
      .from("carts")
      .insert({
        customer_id: customerId,
        status: "active",
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("Erro ao criar carrinho:", error);
      return null;
    }

    return newCart as Cart;
  }

  // Se tem session_id, busca carrinho da sessão
  if (sessionId) {
    const { data: existingCart } = await supabaseAdmin
      .from("carts")
      .select("*")
      .eq("session_id", sessionId)
      .eq("status", "active")
      .single();

    if (existingCart) {
      return existingCart as Cart;
    }

    // Criar novo carrinho para a sessão
    const { data: newCart, error } = await supabaseAdmin
      .from("carts")
      .insert({
        session_id: sessionId,
        status: "active",
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("Erro ao criar carrinho:", error);
      return null;
    }

    return newCart as Cart;
  }

  return null;
}

// Helper para buscar carrinho com itens
async function getCartWithItems(cartId: string): Promise<Cart | null> {
  const { data: cart, error: cartError } = await supabaseAdmin
    .from("carts")
    .select("*")
    .eq("id", cartId)
    .single();

  if (cartError || !cart) {
    return null;
  }

  const { data: items, error: itemsError } = await supabaseAdmin
    .from("cart_items")
    .select(`
      *,
      product:products(id, name, slug, price, original_price, images, stock_quantity, is_active)
    `)
    .eq("cart_id", cartId)
    .order("created_at", { ascending: true });

  if (itemsError) {
    console.error("Erro ao buscar itens:", itemsError);
    return { ...cart, items: [] } as Cart;
  }

  return { ...cart, items: items || [] } as Cart;
}

// GET /api/cart - Obter carrinho atual
router.get("/", optionalCustomerAuthMiddleware, async (req: CustomerRequest, res: Response) => {
  try {
    const customerId = req.customer?.id;
    const sessionId = req.headers["x-cart-session"] as string;

    if (!customerId && !sessionId) {
      return res.json({
        success: true,
        data: {
          id: null,
          items: [],
          itemCount: 0,
          subtotal: 0,
        }
      });
    }

    // Buscar carrinho existente
    let cart: Cart | null = null;

    if (customerId) {
      const { data } = await supabaseAdmin
        .from("carts")
        .select("*")
        .eq("customer_id", customerId)
        .eq("status", "active")
        .single();
      
      if (data) {
        cart = await getCartWithItems(data.id);
      }
    } else if (sessionId) {
      const { data } = await supabaseAdmin
        .from("carts")
        .select("*")
        .eq("session_id", sessionId)
        .eq("status", "active")
        .single();
      
      if (data) {
        cart = await getCartWithItems(data.id);
      }
    }

    if (!cart) {
      return res.json({
        success: true,
        data: {
          id: null,
          items: [],
          itemCount: 0,
          subtotal: 0,
        }
      });
    }

    // Calcular totais
    const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = cart.items.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);

    return res.json({
      success: true,
      data: {
        id: cart.id,
        items: cart.items,
        itemCount,
        subtotal,
      }
    });
  } catch (error) {
    console.error("Erro ao buscar carrinho:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor"
    });
  }
});

// POST /api/cart/add - Adicionar item ao carrinho
router.post("/add", optionalCustomerAuthMiddleware, async (req: CustomerRequest, res: Response) => {
  try {
    const validation = addToCartSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Dados inválidos",
        errors: validation.error.errors,
      });
    }

    const { product_id, quantity } = validation.data;
    const customerId = req.customer?.id;
    let sessionId = req.headers["x-cart-session"] as string;

    // Se não tem customer nem session, cria uma nova session
    if (!customerId && !sessionId) {
      sessionId = generateSessionId();
    }

    // Verificar se o produto existe e está disponível
    const { data: product, error: productError } = await supabaseAdmin
      .from("products")
      .select("id, name, price, stock_quantity, is_active")
      .eq("id", product_id)
      .single();

    if (productError || !product) {
      return res.status(404).json({
        success: false,
        message: "Produto não encontrado"
      });
    }

    if (!product.is_active) {
      return res.status(400).json({
        success: false,
        message: "Produto indisponível"
      });
    }

    if (product.stock_quantity < quantity) {
      return res.status(400).json({
        success: false,
        message: `Estoque insuficiente. Disponível: ${product.stock_quantity}`
      });
    }

    // Buscar ou criar carrinho
    const cart = await getOrCreateCart(customerId, sessionId);
    if (!cart) {
      return res.status(500).json({
        success: false,
        message: "Erro ao criar carrinho"
      });
    }

    // Verificar se o produto já está no carrinho
    const { data: existingItem } = await supabaseAdmin
      .from("cart_items")
      .select("*")
      .eq("cart_id", cart.id)
      .eq("product_id", product_id)
      .single();

    if (existingItem) {
      // Atualizar quantidade
      const newQuantity = existingItem.quantity + quantity;
      
      if (newQuantity > product.stock_quantity) {
        return res.status(400).json({
          success: false,
          message: `Estoque insuficiente. Máximo disponível: ${product.stock_quantity}`
        });
      }

      const { error: updateError } = await supabaseAdmin
        .from("cart_items")
        .update({ quantity: newQuantity, unit_price: product.price })
        .eq("id", existingItem.id);

      if (updateError) {
        return res.status(500).json({
          success: false,
          message: "Erro ao atualizar item"
        });
      }
    } else {
      // Adicionar novo item
      const { error: insertError } = await supabaseAdmin
        .from("cart_items")
        .insert({
          cart_id: cart.id,
          product_id,
          quantity,
          unit_price: product.price,
        });

      if (insertError) {
        return res.status(500).json({
          success: false,
          message: "Erro ao adicionar item"
        });
      }
    }

    // Buscar carrinho atualizado
    const updatedCart = await getCartWithItems(cart.id);
    const itemCount = updatedCart?.items.reduce((sum, item) => sum + item.quantity, 0) || 0;
    const subtotal = updatedCart?.items.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0) || 0;

    return res.json({
      success: true,
      message: "Produto adicionado ao carrinho",
      data: {
        id: cart.id,
        sessionId: customerId ? undefined : sessionId,
        items: updatedCart?.items || [],
        itemCount,
        subtotal,
      }
    });
  } catch (error) {
    console.error("Erro ao adicionar ao carrinho:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor"
    });
  }
});

// PUT /api/cart/item/:itemId - Atualizar quantidade de item
router.put("/item/:itemId", optionalCustomerAuthMiddleware, async (req: CustomerRequest, res: Response) => {
  try {
    const { itemId } = req.params;
    const validation = updateQuantitySchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Quantidade inválida",
        errors: validation.error.errors,
      });
    }

    const { quantity } = validation.data;
    const customerId = req.customer?.id;
    const sessionId = req.headers["x-cart-session"] as string;

    // Buscar item e verificar propriedade
    const { data: item, error: itemError } = await supabaseAdmin
      .from("cart_items")
      .select(`
        *,
        cart:carts(*),
        product:products(stock_quantity)
      `)
      .eq("id", itemId)
      .single();

    if (itemError || !item) {
      return res.status(404).json({
        success: false,
        message: "Item não encontrado"
      });
    }

    // Verificar se o carrinho pertence ao usuário
    const cart = item.cart as Cart;
    if (customerId) {
      if (cart.customer_id !== customerId) {
        return res.status(403).json({
          success: false,
          message: "Acesso negado"
        });
      }
    } else if (sessionId) {
      if (cart.session_id !== sessionId) {
        return res.status(403).json({
          success: false,
          message: "Acesso negado"
        });
      }
    } else {
      return res.status(403).json({
        success: false,
        message: "Acesso negado"
      });
    }

    // Verificar estoque
    const product = item.product as { stock_quantity: number };
    if (quantity > product.stock_quantity) {
      return res.status(400).json({
        success: false,
        message: `Estoque insuficiente. Máximo disponível: ${product.stock_quantity}`
      });
    }

    // Atualizar quantidade
    const { error: updateError } = await supabaseAdmin
      .from("cart_items")
      .update({ quantity })
      .eq("id", itemId);

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: "Erro ao atualizar item"
      });
    }

    // Buscar carrinho atualizado
    const updatedCart = await getCartWithItems(cart.id);
    const itemCount = updatedCart?.items.reduce((sum, i) => sum + i.quantity, 0) || 0;
    const subtotal = updatedCart?.items.reduce((sum, i) => sum + (i.unit_price * i.quantity), 0) || 0;

    return res.json({
      success: true,
      message: "Quantidade atualizada",
      data: {
        id: cart.id,
        items: updatedCart?.items || [],
        itemCount,
        subtotal,
      }
    });
  } catch (error) {
    console.error("Erro ao atualizar item:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor"
    });
  }
});

// DELETE /api/cart/item/:itemId - Remover item do carrinho
router.delete("/item/:itemId", optionalCustomerAuthMiddleware, async (req: CustomerRequest, res: Response) => {
  try {
    const { itemId } = req.params;
    const customerId = req.customer?.id;
    const sessionId = req.headers["x-cart-session"] as string;

    // Buscar item e verificar propriedade
    const { data: item, error: itemError } = await supabaseAdmin
      .from("cart_items")
      .select(`*, cart:carts(*)`)
      .eq("id", itemId)
      .single();

    if (itemError || !item) {
      return res.status(404).json({
        success: false,
        message: "Item não encontrado"
      });
    }

    // Verificar se o carrinho pertence ao usuário
    const cart = item.cart as Cart;
    if (customerId) {
      if (cart.customer_id !== customerId) {
        return res.status(403).json({
          success: false,
          message: "Acesso negado"
        });
      }
    } else if (sessionId) {
      if (cart.session_id !== sessionId) {
        return res.status(403).json({
          success: false,
          message: "Acesso negado"
        });
      }
    } else {
      return res.status(403).json({
        success: false,
        message: "Acesso negado"
      });
    }

    // Remover item
    const { error: deleteError } = await supabaseAdmin
      .from("cart_items")
      .delete()
      .eq("id", itemId);

    if (deleteError) {
      return res.status(500).json({
        success: false,
        message: "Erro ao remover item"
      });
    }

    // Buscar carrinho atualizado
    const updatedCart = await getCartWithItems(cart.id);
    const itemCount = updatedCart?.items.reduce((sum, i) => sum + i.quantity, 0) || 0;
    const subtotal = updatedCart?.items.reduce((sum, i) => sum + (i.unit_price * i.quantity), 0) || 0;

    return res.json({
      success: true,
      message: "Item removido",
      data: {
        id: cart.id,
        items: updatedCart?.items || [],
        itemCount,
        subtotal,
      }
    });
  } catch (error) {
    console.error("Erro ao remover item:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor"
    });
  }
});

// DELETE /api/cart - Limpar carrinho
router.delete("/", optionalCustomerAuthMiddleware, async (req: CustomerRequest, res: Response) => {
  try {
    const customerId = req.customer?.id;
    const sessionId = req.headers["x-cart-session"] as string;

    if (!customerId && !sessionId) {
      return res.status(400).json({
        success: false,
        message: "Sessão não identificada"
      });
    }

    // Buscar carrinho
    let cart: Cart | null = null;

    if (customerId) {
      const { data } = await supabaseAdmin
        .from("carts")
        .select("*")
        .eq("customer_id", customerId)
        .eq("status", "active")
        .single();
      cart = data as Cart;
    } else if (sessionId) {
      const { data } = await supabaseAdmin
        .from("carts")
        .select("*")
        .eq("session_id", sessionId)
        .eq("status", "active")
        .single();
      cart = data as Cart;
    }

    if (!cart) {
      return res.json({
        success: true,
        message: "Carrinho já está vazio",
        data: { id: null, items: [], itemCount: 0, subtotal: 0 }
      });
    }

    // Remover todos os itens
    await supabaseAdmin
      .from("cart_items")
      .delete()
      .eq("cart_id", cart.id);

    return res.json({
      success: true,
      message: "Carrinho limpo",
      data: {
        id: cart.id,
        items: [],
        itemCount: 0,
        subtotal: 0,
      }
    });
  } catch (error) {
    console.error("Erro ao limpar carrinho:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor"
    });
  }
});

// POST /api/cart/merge - Mesclar carrinho de sessão com carrinho do cliente
router.post("/merge", optionalCustomerAuthMiddleware, async (req: CustomerRequest, res: Response) => {
  try {
    const customerId = req.customer?.id;
    const sessionId = req.headers["x-cart-session"] as string;

    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: "Cliente não autenticado"
      });
    }

    if (!sessionId) {
      return res.json({
        success: true,
        message: "Nenhum carrinho de sessão para mesclar"
      });
    }

    // Buscar carrinho da sessão
    const { data: sessionCart } = await supabaseAdmin
      .from("carts")
      .select("*")
      .eq("session_id", sessionId)
      .eq("status", "active")
      .single();

    if (!sessionCart) {
      return res.json({
        success: true,
        message: "Nenhum carrinho de sessão encontrado"
      });
    }

    // Buscar ou criar carrinho do cliente
    const customerCart = await getOrCreateCart(customerId, undefined);
    if (!customerCart) {
      return res.status(500).json({
        success: false,
        message: "Erro ao criar carrinho do cliente"
      });
    }

    // Buscar itens do carrinho da sessão
    const { data: sessionItems } = await supabaseAdmin
      .from("cart_items")
      .select("*")
      .eq("cart_id", sessionCart.id);

    if (sessionItems && sessionItems.length > 0) {
      // Mesclar itens
      for (const item of sessionItems) {
        const { data: existingItem } = await supabaseAdmin
          .from("cart_items")
          .select("*")
          .eq("cart_id", customerCart.id)
          .eq("product_id", item.product_id)
          .single();

        if (existingItem) {
          // Somar quantidades
          await supabaseAdmin
            .from("cart_items")
            .update({ quantity: existingItem.quantity + item.quantity })
            .eq("id", existingItem.id);
        } else {
          // Adicionar novo item
          await supabaseAdmin
            .from("cart_items")
            .insert({
              cart_id: customerCart.id,
              product_id: item.product_id,
              quantity: item.quantity,
              unit_price: item.unit_price,
            });
        }
      }
    }

    // Marcar carrinho da sessão como abandonado
    await supabaseAdmin
      .from("carts")
      .update({ status: "abandoned" })
      .eq("id", sessionCart.id);

    // Buscar carrinho atualizado
    const updatedCart = await getCartWithItems(customerCart.id);
    const itemCount = updatedCart?.items.reduce((sum, i) => sum + i.quantity, 0) || 0;
    const subtotal = updatedCart?.items.reduce((sum, i) => sum + (i.unit_price * i.quantity), 0) || 0;

    return res.json({
      success: true,
      message: "Carrinhos mesclados com sucesso",
      data: {
        id: customerCart.id,
        items: updatedCart?.items || [],
        itemCount,
        subtotal,
      }
    });
  } catch (error) {
    console.error("Erro ao mesclar carrinhos:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor"
    });
  }
});

export default router;
