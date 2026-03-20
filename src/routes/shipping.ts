import { Router, Request, Response } from "express";
import { z } from "zod";
import { optionalCustomerAuthMiddleware, CustomerRequest } from "../middlewares/customerAuth.js";

// Tipos para ViaCEP
interface ViaCepResponse {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

// Tipos para Nominatim
interface NominatimResult {
  lat: string;
  lon: string;
}

// Tipos para OpenRouteService
interface OpenRouteResponse {
  features?: Array<{
    properties: {
      segments: Array<{
        distance: number;
        duration: number;
      }>;
    };
  }>;
}

const router = Router();

// ============================================
// CONFIGURAÇÕES DE FRETE
// ============================================

// Endereço da loja (Goiânia)
const STORE_LOCATION = {
  lat: -16.601617249986067,
  lng: -49.324691876891954,
  address: "Goiânia, GO"
};

// Configurações de preço
const SHIPPING_CONFIG = {
  basePrice: 5.00,      // Taxa base em R$
  pricePerKm: 2.60,     // Preço por km em R$
  minimumPrice: 10.00,  // Preço mínimo em R$
  maximumDistance: 30,  // Distância máxima em km (apenas Goiânia)
};

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

// Converter CEP em coordenadas usando Nominatim (OpenStreetMap)
async function geocodeCep(cep: string): Promise<{ lat: number; lng: number; address: string } | null> {
  try {
    // Primeiro, buscar endereço pelo ViaCEP
    const viaCepResponse = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const viaCepData = await viaCepResponse.json() as ViaCepResponse;
    
    if (viaCepData.erro) {
      return null;
    }

    // Montar endereço para geocoding
    const searchAddress = `${viaCepData.logradouro}, ${viaCepData.bairro}, ${viaCepData.localidade}, ${viaCepData.uf}, Brasil`;
    
    // Usar Nominatim para converter em coordenadas
    const nominatimResponse = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchAddress)}&limit=1`,
      {
        headers: {
          "User-Agent": "LojaDaDay/1.0" // Obrigatório para Nominatim
        }
      }
    );
    
    const nominatimData = await nominatimResponse.json() as NominatimResult[];
    
    if (nominatimData.length === 0) {
      // Fallback: tentar só com cidade e estado
      const fallbackResponse = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(`${viaCepData.localidade}, ${viaCepData.uf}, Brasil`)}&limit=1`,
        {
          headers: {
            "User-Agent": "LojaDaDay/1.0"
          }
        }
      );
      const fallbackData = await fallbackResponse.json() as NominatimResult[];
      
      if (fallbackData.length === 0) {
        return null;
      }
      
      return {
        lat: parseFloat(fallbackData[0].lat),
        lng: parseFloat(fallbackData[0].lon),
        address: `${viaCepData.logradouro}, ${viaCepData.bairro}, ${viaCepData.localidade} - ${viaCepData.uf}`
      };
    }
    
    return {
      lat: parseFloat(nominatimData[0].lat),
      lng: parseFloat(nominatimData[0].lon),
      address: `${viaCepData.logradouro}, ${viaCepData.bairro}, ${viaCepData.localidade} - ${viaCepData.uf}`
    };
  } catch (error) {
    console.error("Erro ao geocodificar CEP:", error);
    return null;
  }
}

// Calcular distância usando OpenRouteService
async function calculateDistance(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<{ distance: number; duration: number } | null> {
  try {
    const apiKey = process.env.OPENROUTE_API_KEY;
    
    if (!apiKey) {
      console.error("OPENROUTE_API_KEY não configurada");
      // Fallback: cálculo por linha reta (Haversine) * 1.3
      const R = 6371; // Raio da Terra em km
      const dLat = (destLat - originLat) * Math.PI / 180;
      const dLon = (destLng - originLng) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(originLat * Math.PI / 180) * Math.cos(destLat * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distance = R * c * 1.3; // Multiplica por 1.3 para aproximar rota real
      
      return {
        distance: Math.round(distance * 10) / 10,
        duration: Math.round(distance * 3) // Estimativa: 3 min/km
      };
    }

    const response = await fetch(
      `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${apiKey}&start=${originLng},${originLat}&end=${destLng},${destLat}`
    );
    
    if (!response.ok) {
      throw new Error("Erro na API OpenRouteService");
    }
    
    const data = await response.json() as OpenRouteResponse;
    
    if (!data.features || data.features.length === 0) {
      return null;
    }
    
    const segment = data.features[0].properties.segments[0];
    
    return {
      distance: Math.round(segment.distance / 100) / 10, // metros para km
      duration: Math.round(segment.duration / 60) // segundos para minutos
    };
  } catch (error) {
    console.error("Erro ao calcular distância:", error);
    return null;
  }
}

// Calcular preço do frete
function calculateShippingPrice(distanceKm: number): number {
  // Calcular preço
  let price = SHIPPING_CONFIG.basePrice + (distanceKm * SHIPPING_CONFIG.pricePerKm);
  
  // Aplicar preço mínimo
  if (price < SHIPPING_CONFIG.minimumPrice) {
    price = SHIPPING_CONFIG.minimumPrice;
  }
  
  return Math.round(price * 100) / 100;
}

// ============================================
// ROTAS
// ============================================

// Schema de validação
const calculateShippingSchema = z.object({
  cep: z.string().regex(/^\d{8}$/, "CEP deve ter 8 dígitos"),
  cartTotal: z.number().optional(),
});

// POST /api/shipping/calculate - Calcular frete por CEP
router.post("/calculate", optionalCustomerAuthMiddleware, async (req: CustomerRequest, res: Response) => {
  try {
    const validation = calculateShippingSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: validation.error.errors[0].message,
      });
    }

    const { cep, cartTotal } = validation.data;

    // Validar se é Goiânia (CEP começa com 74)
    if (!cep.startsWith("74")) {
      return res.status(400).json({
        success: false,
        message: "Desculpe, no momento só entregamos em Goiânia",
        data: {
          available: false
        }
      });
    }

    // Geocodificar o CEP do cliente
    const clientLocation = await geocodeCep(cep);
    
    if (!clientLocation) {
      return res.status(400).json({
        success: false,
        message: "Não foi possível localizar este CEP",
      });
    }

    // Calcular distância
    const routeInfo = await calculateDistance(
      STORE_LOCATION.lat,
      STORE_LOCATION.lng,
      clientLocation.lat,
      clientLocation.lng
    );

    if (!routeInfo) {
      return res.status(500).json({
        success: false,
        message: "Erro ao calcular a rota",
      });
    }

    // Verificar distância máxima
    if (routeInfo.distance > SHIPPING_CONFIG.maximumDistance) {
      return res.status(400).json({
        success: false,
        message: `Desculpe, a distância máxima de entrega é ${SHIPPING_CONFIG.maximumDistance}km`,
        data: {
          available: false,
          distance: routeInfo.distance
        }
      });
    }

    // Calcular preço
    const shippingPrice = calculateShippingPrice(routeInfo.distance);

    return res.json({
      success: true,
      data: {
        available: true,
        cep,
        address: clientLocation.address,
        distance: routeInfo.distance,
        duration: routeInfo.duration,
        price: shippingPrice,
        deliveryTime: "6h~12h",
      }
    });
  } catch (error) {
    console.error("Erro ao calcular frete:", error);
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// GET /api/shipping/config - Obter configurações de frete (público)
router.get("/config", (req: Request, res: Response) => {
  return res.json({
    success: true,
    data: {
      basePrice: SHIPPING_CONFIG.basePrice,
      pricePerKm: SHIPPING_CONFIG.pricePerKm,
      minimumPrice: SHIPPING_CONFIG.minimumPrice,
      maximumDistance: SHIPPING_CONFIG.maximumDistance,
      deliveryArea: "Goiânia - GO",
      deliveryTime: "6h~12h",
      cepPrefix: "74",
    }
  });
});

export default router;
