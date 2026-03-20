import { Router, Response } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../config/supabase.js";
import { customerAuthMiddleware, CustomerRequest } from "../middlewares/customerAuth.js";

// Tipos para ViaCEP
interface ViaCepResponse {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

const router = Router();

// Todas as rotas requerem autenticação de cliente
router.use(customerAuthMiddleware);

// ============================================
// SCHEMAS DE VALIDAÇÃO
// ============================================

// CEPs válidos de Goiânia começam com 74
const goianiaCepRegex = /^74\d{3}-?\d{3}$/;

const addressSchema = z.object({
  label: z.string().max(50).optional().default("Casa"),
  is_default: z.boolean().optional().default(false),
  cep: z.string().regex(goianiaCepRegex, "CEP inválido. Entregamos apenas em Goiânia (CEP iniciado com 74)"),
  street: z.string().min(3, "Rua obrigatória"),
  number: z.string().min(1, "Número obrigatório"),
  complement: z.string().max(100).optional(),
  neighborhood: z.string().min(2, "Bairro obrigatório"),
  city: z.string().min(2, "Cidade obrigatória"),
  state: z.string().length(2, "Estado deve ter 2 caracteres"),
  recipient_name: z.string().optional(),
  recipient_phone: z.string().optional(),
});

// ============================================
// VALIDAR CEP VIA VIACEP
// ============================================
async function validateCepGoiania(cep: string): Promise<{ valid: boolean; data?: any; error?: string }> {
  try {
    // Remover hífen
    const cleanCep = cep.replace("-", "");
    
    // Verificar se é CEP de Goiânia (começa com 74)
    if (!cleanCep.startsWith("74")) {
      return { 
        valid: false, 
        error: "Desculpe, entregamos apenas em Goiânia. O CEP deve iniciar com 74." 
      };
    }

    // Consultar ViaCEP
    const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
    const data = await response.json() as ViaCepResponse;

    if (data.erro) {
      return { valid: false, error: "CEP não encontrado" };
    }

    // Verificar se é de Goiânia
    if (data.localidade?.toLowerCase() !== "goiânia") {
      return { 
        valid: false, 
        error: `Desculpe, entregamos apenas em Goiânia. Este CEP é de ${data.localidade}.` 
      };
    }

    return { valid: true, data };
  } catch (error) {
    console.error("ViaCEP error:", error);
    return { valid: false, error: "Erro ao validar CEP" };
  }
}

// ============================================
// VALIDAR CEP (endpoint público para o frontend)
// ============================================
router.get("/validate-cep/:cep", async (req: CustomerRequest, res: Response) => {
  try {
    const { cep } = req.params;
    const result = await validateCepGoiania(cep);

    if (!result.valid) {
      return res.status(400).json({
        success: false,
        message: result.error,
      });
    }

    res.json({
      success: true,
      data: {
        cep: result.data.cep,
        street: result.data.logradouro,
        neighborhood: result.data.bairro,
        city: result.data.localidade,
        state: result.data.uf,
      },
    });
  } catch (error) {
    console.error("Validate CEP error:", error);
    res.status(500).json({
      success: false,
      message: "Erro ao validar CEP",
    });
  }
});

// ============================================
// LISTAR ENDEREÇOS DO CLIENTE
// ============================================
router.get("/", async (req: CustomerRequest, res: Response) => {
  try {
    const { data: addresses, error } = await supabaseAdmin
      .from("customer_addresses")
      .select("*")
      .eq("customer_id", req.customer!.id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Get addresses error:", error);
      return res.status(500).json({
        success: false,
        message: "Erro ao buscar endereços",
      });
    }

    res.json({
      success: true,
      data: addresses,
    });
  } catch (error) {
    console.error("Get addresses error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ============================================
// OBTER ENDEREÇO POR ID
// ============================================
router.get("/:id", async (req: CustomerRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { data: address, error } = await supabaseAdmin
      .from("customer_addresses")
      .select("*")
      .eq("id", id)
      .eq("customer_id", req.customer!.id)
      .single();

    if (error || !address) {
      return res.status(404).json({
        success: false,
        message: "Endereço não encontrado",
      });
    }

    res.json({
      success: true,
      data: address,
    });
  } catch (error) {
    console.error("Get address error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ============================================
// CRIAR ENDEREÇO
// ============================================
router.post("/", async (req: CustomerRequest, res: Response) => {
  try {
    const validation = addressSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: validation.error.errors[0].message,
      });
    }

    const addressData = validation.data;

    // Validar CEP de Goiânia
    const cepValidation = await validateCepGoiania(addressData.cep);
    if (!cepValidation.valid) {
      return res.status(400).json({
        success: false,
        message: cepValidation.error,
      });
    }

    // Verificar limite de endereços (máximo 5)
    const { count } = await supabaseAdmin
      .from("customer_addresses")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", req.customer!.id);

    if (count && count >= 5) {
      return res.status(400).json({
        success: false,
        message: "Você atingiu o limite de 5 endereços cadastrados",
      });
    }

    // Se é o primeiro endereço, definir como padrão
    if (count === 0) {
      addressData.is_default = true;
    }

    const { data: address, error } = await supabaseAdmin
      .from("customer_addresses")
      .insert({
        customer_id: req.customer!.id,
        ...addressData,
      })
      .select()
      .single();

    if (error) {
      console.error("Create address error:", error);
      return res.status(500).json({
        success: false,
        message: "Erro ao criar endereço",
      });
    }

    res.status(201).json({
      success: true,
      message: "Endereço criado com sucesso",
      data: address,
    });
  } catch (error) {
    console.error("Create address error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ============================================
// ATUALIZAR ENDEREÇO
// ============================================
router.put("/:id", async (req: CustomerRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Verificar se endereço pertence ao cliente
    const { data: existingAddress } = await supabaseAdmin
      .from("customer_addresses")
      .select("id")
      .eq("id", id)
      .eq("customer_id", req.customer!.id)
      .single();

    if (!existingAddress) {
      return res.status(404).json({
        success: false,
        message: "Endereço não encontrado",
      });
    }

    const validation = addressSchema.partial().safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: validation.error.errors[0].message,
      });
    }

    const addressData = validation.data;

    // Se atualizando CEP, validar
    if (addressData.cep) {
      const cepValidation = await validateCepGoiania(addressData.cep);
      if (!cepValidation.valid) {
        return res.status(400).json({
          success: false,
          message: cepValidation.error,
        });
      }
    }

    const { data: address, error } = await supabaseAdmin
      .from("customer_addresses")
      .update(addressData)
      .eq("id", id)
      .eq("customer_id", req.customer!.id)
      .select()
      .single();

    if (error) {
      console.error("Update address error:", error);
      return res.status(500).json({
        success: false,
        message: "Erro ao atualizar endereço",
      });
    }

    res.json({
      success: true,
      message: "Endereço atualizado com sucesso",
      data: address,
    });
  } catch (error) {
    console.error("Update address error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ============================================
// DEFINIR ENDEREÇO COMO PADRÃO
// ============================================
router.patch("/:id/default", async (req: CustomerRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Verificar se endereço pertence ao cliente
    const { data: existingAddress } = await supabaseAdmin
      .from("customer_addresses")
      .select("id")
      .eq("id", id)
      .eq("customer_id", req.customer!.id)
      .single();

    if (!existingAddress) {
      return res.status(404).json({
        success: false,
        message: "Endereço não encontrado",
      });
    }

    // O trigger no banco cuidará de remover o padrão dos outros
    const { data: address, error } = await supabaseAdmin
      .from("customer_addresses")
      .update({ is_default: true })
      .eq("id", id)
      .eq("customer_id", req.customer!.id)
      .select()
      .single();

    if (error) {
      console.error("Set default address error:", error);
      return res.status(500).json({
        success: false,
        message: "Erro ao definir endereço padrão",
      });
    }

    res.json({
      success: true,
      message: "Endereço padrão atualizado",
      data: address,
    });
  } catch (error) {
    console.error("Set default address error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// ============================================
// EXCLUIR ENDEREÇO
// ============================================
router.delete("/:id", async (req: CustomerRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Verificar se endereço pertence ao cliente
    const { data: existingAddress } = await supabaseAdmin
      .from("customer_addresses")
      .select("id, is_default")
      .eq("id", id)
      .eq("customer_id", req.customer!.id)
      .single();

    if (!existingAddress) {
      return res.status(404).json({
        success: false,
        message: "Endereço não encontrado",
      });
    }

    // Excluir endereço
    const { error } = await supabaseAdmin
      .from("customer_addresses")
      .delete()
      .eq("id", id)
      .eq("customer_id", req.customer!.id);

    if (error) {
      console.error("Delete address error:", error);
      return res.status(500).json({
        success: false,
        message: "Erro ao excluir endereço",
      });
    }

    // Se era o padrão, definir outro como padrão
    if (existingAddress.is_default) {
      const { data: firstAddress } = await supabaseAdmin
        .from("customer_addresses")
        .select("id")
        .eq("customer_id", req.customer!.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .single();

      if (firstAddress) {
        await supabaseAdmin
          .from("customer_addresses")
          .update({ is_default: true })
          .eq("id", firstAddress.id);
      }
    }

    res.json({
      success: true,
      message: "Endereço excluído com sucesso",
    });
  } catch (error) {
    console.error("Delete address error:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

export default router;
