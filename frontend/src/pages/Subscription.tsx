import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, ArrowLeft, Crown, Zap, Star } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const plans = [
  {
    id: "free",
    name: "무료",
    price: "₩0",
    period: "월",
    description: "기본 기능을 무료로 사용하세요",
    icon: Star,
    features: [
      "만다라트 1개 생성",
      "최대 50개 카드 저장",
      "기본 템플릿 사용",
      "커뮤니티 지원",
    ],
    buttonText: "현재 플랜",
    current: true,
  },
  {
    id: "pro",
    name: "프로",
    price: "₩9,900",
    period: "월",
    description: "더 많은 기능으로 생산성을 높이세요",
    icon: Zap,
    popular: true,
    features: [
      "만다라트 무제한 생성",
      "카드 무제한 저장",
      "프리미엄 템플릿 사용",
      "클라우드 동기화",
      "우선 지원",
    ],
    buttonText: "업그레이드",
    current: false,
  },
  {
    id: "enterprise",
    name: "엔터프라이즈",
    price: "₩29,900",
    period: "월",
    description: "팀과 함께 협업하세요",
    icon: Crown,
    features: [
      "프로 플랜의 모든 기능",
      "팀 협업 기능",
      "관리자 대시보드",
      "API 접근",
      "전담 지원",
      "맞춤형 온보딩",
    ],
    buttonText: "문의하기",
    current: false,
  },
];

export default function Subscription() {
  const navigate = useNavigate();
  const [selectedPlan, setSelectedPlan] = useState("free");

  const handleSelectPlan = (planId: string) => {
    if (planId === "free") return;
    
    toast({
      title: "준비 중",
      description: "결제 기능은 곧 출시될 예정입니다.",
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Header onNavigateHome={() => navigate("/")} />
      
      <main className="container mx-auto px-4 py-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(-1)}
          className="mb-6 gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          뒤로가기
        </Button>

        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-foreground mb-2">구독 플랜</h1>
          <p className="text-muted-foreground">필요에 맞는 플랜을 선택하세요</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {plans.map((plan) => (
            <Card 
              key={plan.id}
              className={`bg-surface-mid border-border/50 relative transition-all duration-200 hover:border-primary/50 ${
                plan.popular ? "ring-2 ring-primary" : ""
              }`}
            >
              {plan.popular && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                  인기
                </Badge>
              )}
              <CardHeader className="text-center pb-2">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <plan.icon className="w-6 h-6 text-primary" />
                </div>
                <CardTitle className="text-xl">{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <div className="mb-6">
                  <span className="text-4xl font-bold text-foreground">{plan.price}</span>
                  <span className="text-muted-foreground">/{plan.period}</span>
                </div>
                <ul className="space-y-3 text-left">
                  {plan.features.map((feature, index) => (
                    <li key={index} className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-primary flex-shrink-0" />
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button 
                  className="w-full"
                  variant={plan.current ? "outline" : "default"}
                  disabled={plan.current}
                  onClick={() => handleSelectPlan(plan.id)}
                >
                  {plan.buttonText}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>

        {/* Current Plan Info */}
        <Card className="mt-10 max-w-2xl mx-auto bg-surface-mid border-border/50">
          <CardHeader>
            <CardTitle className="text-lg">현재 구독 정보</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">현재 플랜</span>
              <Badge variant="outline">무료</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">사용 중인 만다라트</span>
              <span className="font-medium">1 / 1</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">저장된 카드</span>
              <span className="font-medium">12 / 50</span>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
