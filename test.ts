import { synapse } from "./synapse";

type Pet = {
  name: string;
};

const sock = synapse<Pet>({ name: "sock" });

sock.subscribe(() => {
  console.log("[Pet] changed (global)");
});

type User = {
  name: string;
  userId: string;
  pet: Pet;
};

const user = synapse<User>({
  name: "User1",
  userId: "ajobsdojabsdojbasdjob-ajobsdojabsdojbasdjob",
  pet: sock,
});

user.subscribe(() => {
  console.log("[User] changed (global)");
});

user.subscribeKey("name", () => {
  console.log("[User] 's username changed, new value: ", user.name);
});

user.subscribeKey("pet", () => {
  console.log("[User] 's pet changed, new value: ", user.pet);
});

// //////////////////////////

user.name = "User2";
sock.name = "sock2";
