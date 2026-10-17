import LevelUpCard from "./LevelUpCard";
import SkillToast from "./SkillToast";

/** The open world's overlays on every screen: loaded by App only once the inventory is in use */
export default function WorldOverlays() {
  return (
    <>
      <SkillToast />
      <LevelUpCard />
    </>
  );
}
