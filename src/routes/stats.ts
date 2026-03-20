import { Router, Request, Response } from "express";
import { supabaseAdmin } from "../config/supabase.js";
import { authMiddleware, adminMiddleware } from "../middlewares/auth.js";

const router = Router();

// GET /api/stats - Estatísticas do dashboard (admin only)
router.get("/", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);

    // ====== PRODUTOS ======
    const { count: totalProducts } = await supabaseAdmin
      .from("products")
      .select("*", { count: "exact", head: true });

    const { count: activeProducts } = await supabaseAdmin
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true);

    // ====== CATEGORIAS ======
    const { count: totalCategories } = await supabaseAdmin
      .from("categories")
      .select("*", { count: "exact", head: true });

    const { count: activeCategories } = await supabaseAdmin
      .from("categories")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true);

    // ====== ESTOQUE ======
    const { data: stockData } = await supabaseAdmin
      .from("products")
      .select("stock_quantity, price")
      .eq("is_active", true);

    const totalStock = stockData?.reduce((acc, p) => acc + (p.stock_quantity || 0), 0) || 0;
    const totalValue = stockData?.reduce((acc, p) => acc + ((p.price || 0) * (p.stock_quantity || 0)), 0) || 0;

    // Produtos com baixo estoque (menos de 10)
    const { data: lowStockProducts } = await supabaseAdmin
      .from("products")
      .select("id, name, slug, images, stock_quantity, price")
      .eq("is_active", true)
      .lt("stock_quantity", 10)
      .gt("stock_quantity", 0)
      .order("stock_quantity", { ascending: true })
      .limit(10);

    // Produtos sem estoque
    const { count: outOfStock } = await supabaseAdmin
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true)
      .eq("stock_quantity", 0);

    const { count: featuredProducts } = await supabaseAdmin
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("is_featured", true)
      .eq("is_active", true);

    // ====== PEDIDOS ======
    // Total de pedidos
    const { count: totalOrders } = await supabaseAdmin
      .from("orders")
      .select("*", { count: "exact", head: true });

    // Pedidos pendentes
    const { count: pendingOrders } = await supabaseAdmin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");

    // Pedidos pagos aguardando envio
    const { count: paidOrders } = await supabaseAdmin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "paid");

    // Pedidos enviados
    const { count: shippedOrders } = await supabaseAdmin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "shipped");

    // Pedidos entregues
    const { count: deliveredOrders } = await supabaseAdmin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "delivered");

    // Pedidos cancelados
    const { count: cancelledOrders } = await supabaseAdmin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "cancelled");

    // ====== VENDAS DO MES ======
    const { data: monthlyOrders } = await supabaseAdmin
      .from("orders")
      .select("total, created_at")
      .in("status", ["paid", "shipped", "delivered"])
      .gte("created_at", startOfMonth.toISOString());

    const monthlyRevenue = monthlyOrders?.reduce((acc, o) => acc + Number(o.total || 0), 0) || 0;
    const monthlySalesCount = monthlyOrders?.length || 0;

    // ====== VENDAS DO MES PASSADO (para comparacao) ======
    const { data: lastMonthOrders } = await supabaseAdmin
      .from("orders")
      .select("total")
      .in("status", ["paid", "shipped", "delivered"])
      .gte("created_at", startOfLastMonth.toISOString())
      .lte("created_at", endOfLastMonth.toISOString());

    const lastMonthRevenue = lastMonthOrders?.reduce((acc, o) => acc + Number(o.total || 0), 0) || 0;

    // ====== VENDAS DE HOJE ======
    const { data: todayOrders } = await supabaseAdmin
      .from("orders")
      .select("total")
      .in("status", ["paid", "shipped", "delivered"])
      .gte("created_at", today.toISOString());

    const todayRevenue = todayOrders?.reduce((acc, o) => acc + Number(o.total || 0), 0) || 0;
    const todaySalesCount = todayOrders?.length || 0;

    // ====== TICKET MEDIO ======
    const avgTicket = monthlySalesCount > 0 ? monthlyRevenue / monthlySalesCount : 0;

    // ====== PEDIDOS RECENTES ======
    const { data: recentOrders } = await supabaseAdmin
      .from("orders")
      .select(`
        id,
        status,
        payment_status,
        total,
        created_at,
        mp_external_reference,
        customer:customers(id, name, email, phone)
      `)
      .order("created_at", { ascending: false })
      .limit(5);

    // ====== PRODUTOS RECENTES ======
    const { data: recentProducts } = await supabaseAdmin
      .from("products")
      .select(`
        id,
        name,
        slug,
        price,
        stock_quantity,
        images,
        is_active,
        is_featured,
        created_at,
        category:categories(id, name)
      `)
      .order("created_at", { ascending: false })
      .limit(5);

    // ====== CATEGORIAS COM CONTAGEM ======
    const { data: categoriesWithCount } = await supabaseAdmin
      .from("categories")
      .select(`
        id,
        name,
        slug,
        is_active,
        products:products(count)
      `)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .limit(5);

    // ====== PRODUTOS MAIS VENDIDOS (baseado nos order_items de pedidos PAGOS) ======
    // Primeiro buscar IDs dos pedidos pagos
    const { data: paidOrderIds } = await supabaseAdmin
      .from("orders")
      .select("id")
      .in("status", ["paid", "shipped", "delivered"]);

    const paidIds = paidOrderIds?.map(o => o.id) || [];

    // Buscar itens apenas dos pedidos pagos
    const { data: topSellingItems } = paidIds.length > 0 
      ? await supabaseAdmin
          .from("order_items")
          .select("product_id, product_name, product_image, quantity")
          .in("order_id", paidIds)
      : { data: [] };

    // Agregar vendas por produto
    const productSales: Record<string, { name: string; image?: string; quantity: number }> = {};
    topSellingItems?.forEach(item => {
      if (!productSales[item.product_id]) {
        productSales[item.product_id] = {
          name: item.product_name,
          image: item.product_image,
          quantity: 0,
        };
      }
      productSales[item.product_id].quantity += item.quantity;
    });

    const topProducts = Object.entries(productSales)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    res.json({
      success: true,
      data: {
        overview: {
          totalProducts: totalProducts || 0,
          activeProducts: activeProducts || 0,
          totalCategories: totalCategories || 0,
          activeCategories: activeCategories || 0,
          totalStock,
          totalValue,
          lowStock: lowStockProducts?.length || 0,
          outOfStock: outOfStock || 0,
          featuredProducts: featuredProducts || 0,
        },
        orders: {
          total: totalOrders || 0,
          pending: pendingOrders || 0,
          paid: paidOrders || 0,
          shipped: shippedOrders || 0,
          delivered: deliveredOrders || 0,
          cancelled: cancelledOrders || 0,
        },
        sales: {
          todayRevenue,
          todaySalesCount,
          monthlyRevenue,
          monthlySalesCount,
          lastMonthRevenue,
          avgTicket,
          revenueGrowth: lastMonthRevenue > 0 
            ? ((monthlyRevenue - lastMonthRevenue) / lastMonthRevenue) * 100 
            : 0,
        },
        lowStockProducts: lowStockProducts || [],
        topProducts,
        recentOrders: recentOrders || [],
        recentProducts: recentProducts || [],
        categoriesWithCount: categoriesWithCount?.map(cat => ({
          ...cat,
          productCount: (cat.products as unknown as { count: number }[])?.[0]?.count || 0,
        })) || [],
      },
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Erro ao buscar estatísticas",
    });
  }
});

export default router;
