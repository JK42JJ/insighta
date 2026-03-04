import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Camera, Save, ArrowLeft } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export default function Profile() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState({
    name: "사용자",
    email: "user@example.com",
    bio: "",
    avatarUrl: "",
  });

  const handleSave = () => {
    localStorage.setItem("user-profile", JSON.stringify(profile));
    toast({
      title: "저장 완료",
      description: "프로필이 성공적으로 저장되었습니다.",
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Header onNavigateHome={() => navigate("/")} />
      
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(-1)}
          className="mb-6 gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          뒤로가기
        </Button>

        <Card className="bg-surface-mid border-border/50">
          <CardHeader>
            <CardTitle className="text-2xl">프로필</CardTitle>
            <CardDescription>계정 정보를 관리하세요</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Avatar Section */}
            <div className="flex items-center gap-6">
              <div className="relative">
                <Avatar className="w-24 h-24 border-4 border-primary/20">
                  <AvatarImage src={profile.avatarUrl} alt={profile.name} />
                  <AvatarFallback className="bg-primary/10 text-primary text-2xl font-medium">
                    {profile.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <button className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center hover:bg-primary/90 transition-colors">
                  <Camera className="w-4 h-4 text-primary-foreground" />
                </button>
              </div>
              <div>
                <h3 className="font-medium text-foreground">{profile.name}</h3>
                <p className="text-sm text-muted-foreground">{profile.email}</p>
              </div>
            </div>

            {/* Form Fields */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">이름</Label>
                <Input
                  id="name"
                  value={profile.name}
                  onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                  placeholder="이름을 입력하세요"
                  className="bg-surface-light border-border/50"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">이메일</Label>
                <Input
                  id="email"
                  type="email"
                  value={profile.email}
                  onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                  placeholder="이메일을 입력하세요"
                  className="bg-surface-light border-border/50"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="bio">소개</Label>
                <Textarea
                  id="bio"
                  value={profile.bio}
                  onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                  placeholder="자기소개를 작성하세요"
                  className="bg-surface-light border-border/50 min-h-[100px]"
                />
              </div>
            </div>

            <Button onClick={handleSave} className="w-full gap-2">
              <Save className="w-4 h-4" />
              저장하기
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
