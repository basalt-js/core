import { definePlugin } from "../index";

export const blogPlugin = definePlugin("blog", {
  config: { postsPerPage: 10, showDrafts: false },
  state: () => ({ posts: [] as Array<{ title: string; slug: string }> }),
  api: ctx => ({
    listPosts: () => ctx.state.posts,
    addPost: (title: string, slug: string) => {
      ctx.state.posts.push({ title, slug });
    },
    getPostsPerPage: () => ctx.config.postsPerPage
  })
});
