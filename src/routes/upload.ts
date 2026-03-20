import { Router } from "express";
import { supabaseAdmin } from "../config/supabase.js";
import { authMiddleware, adminMiddleware } from "../middlewares/auth.js";
import crypto from "crypto";

const router = Router();

// ============================================
// POST /api/upload/image - Upload de imagem
// ============================================
router.post(
  "/image",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const { image, filename, folder = "products" } = req.body;

      if (!image) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Imagem é obrigatória",
        });
      }

      // Extrair dados da imagem base64
      // Formato esperado: data:image/jpeg;base64,/9j/4AAQSkZ...
      const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
      
      if (!matches) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Formato de imagem inválido. Use base64 com data URI.",
        });
      }

      const extension = matches[1];
      const base64Data = matches[2];
      
      // Validar tipo de imagem
      const allowedTypes = ["jpeg", "jpg", "png", "webp", "gif"];
      if (!allowedTypes.includes(extension.toLowerCase())) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Tipo de imagem não permitido. Use: jpeg, png, webp ou gif.",
        });
      }

      // Converter base64 para Buffer
      const buffer = Buffer.from(base64Data, "base64");

      // Validar tamanho (max 5MB)
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (buffer.length > maxSize) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Imagem muito grande. Máximo permitido: 5MB.",
        });
      }

      // Gerar nome único para o arquivo
      const uniqueId = crypto.randomBytes(8).toString("hex");
      const timestamp = Date.now();
      const sanitizedFilename = filename 
        ? filename.replace(/[^a-zA-Z0-9.-]/g, "_").toLowerCase()
        : `image_${timestamp}`;
      const finalFilename = `${folder}/${timestamp}_${uniqueId}_${sanitizedFilename}.${extension}`;

      // Upload para Supabase Storage
      const { data, error } = await supabaseAdmin.storage
        .from("products")
        .upload(finalFilename, buffer, {
          contentType: `image/${extension}`,
          cacheControl: "3600",
          upsert: false,
        });

      if (error) {
        console.error("Supabase upload error:", error);
        return res.status(500).json({
          error: "Upload Error",
          message: "Erro ao fazer upload da imagem.",
          details: error.message,
        });
      }

      // Obter URL pública
      const { data: urlData } = supabaseAdmin.storage
        .from("products")
        .getPublicUrl(finalFilename);

      res.status(201).json({
        success: true,
        message: "Imagem enviada com sucesso",
        data: {
          path: data.path,
          url: urlData.publicUrl,
          filename: finalFilename,
        },
      });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({
        error: "Internal Server Error",
        message: "Erro interno do servidor",
      });
    }
  }
);

// ============================================
// DELETE /api/upload/image - Deletar imagem
// ============================================
router.delete(
  "/image",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const { path } = req.body;

      if (!path) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Caminho da imagem é obrigatório",
        });
      }

      const { error } = await supabaseAdmin.storage
        .from("products")
        .remove([path]);

      if (error) {
        console.error("Supabase delete error:", error);
        return res.status(500).json({
          error: "Delete Error",
          message: "Erro ao deletar imagem.",
          details: error.message,
        });
      }

      res.json({
        success: true,
        message: "Imagem deletada com sucesso",
      });
    } catch (error) {
      console.error("Delete error:", error);
      res.status(500).json({
        error: "Internal Server Error",
        message: "Erro interno do servidor",
      });
    }
  }
);

export default router;
