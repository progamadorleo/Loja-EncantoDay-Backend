import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

// Carregar variáveis de ambiente (deve ser antes de importar rotas)
dotenv.config();

import healthRoutes from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import productsRoutes from "./routes/products.js";
import categoriesRoutes from "./routes/categories.js";
import statsRoutes from "./routes/stats.js";
import uploadRoutes from "./routes/upload.js";
import customerAuthRoutes from "./routes/customerAuth.js";
import customerAddressesRoutes from "./routes/customerAddresses.js";
import customerFavoritesRoutes from "./routes/customerFavorites.js";
import shippingRoutes from "./routes/shipping.js";
import bannersRoutes from "./routes/banners.js";
import cartRoutes from "./routes/cart.js";
import ordersRoutes from "./routes/orders.js";
import webhooksRoutes from "./routes/webhooks.js";
import couponsRoutes from "./routes/coupons.js";

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares de segurança
app.use(helmet());

// CORS configurado
const corsOrigins = process.env.CORS_ORIGINS?.split(",") || ["http://localhost:3000"];
app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-cart-session"],
  })
);

// Logger de requisições
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Parser JSON e cookies (aumentar limite para upload de imagens base64)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Rotas
app.use("/api", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/upload", uploadRoutes);

// Rotas de clientes
app.use("/api/customer/auth", customerAuthRoutes);
app.use("/api/customer/addresses", customerAddressesRoutes);
app.use("/api/customer/favorites", customerFavoritesRoutes);

// Frete
app.use("/api/shipping", shippingRoutes);

// Banners
app.use("/api/banners", bannersRoutes);

// Carrinho
app.use("/api/cart", cartRoutes);

// Pedidos
app.use("/api/orders", ordersRoutes);

// Webhooks (sem autenticacao para receber notificacoes externas)
app.use("/api/webhooks", webhooksRoutes);

// Cupons
app.use("/api/coupons", couponsRoutes);

// Rota raiz
app.get("/", (req, res) => {
  res.json({
    name: "Encanto Day API",
    version: "1.0.0",
    status: "running",
    documentation: "/api/health",
  });
});

// Middleware de erro 404
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `A rota ${req.method} ${req.originalUrl} não existe`,
  });
});

// Middleware de tratamento de erros
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Erro:", err.message);
  res.status(500).json({
    error: "Internal Server Error",
    message: process.env.NODE_ENV === "production" ? "Erro interno do servidor" : err.message,
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   🌸 ENCANTO DAY - API Backend                        ║
║                                                       ║
║   Servidor rodando em: http://localhost:${PORT}          ║
║   Ambiente: ${process.env.NODE_ENV || "development"}                            ║
║   Health check: http://localhost:${PORT}/api/health      ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
  `);
});

export default app;
