# =========== Copyright 2023 @ CAMEL-AI.org. All Rights Reserved. ===========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# =========== Copyright 2023 @ CAMEL-AI.org. All Rights Reserved. ===========
"""Social media simulation (Twitter / Reddit).

This is the original Wonderwall simulation type, now packaged as a
``SimulationConfig`` that can be used with the generic engine.
"""
from wonderwall.simulations.base import SimulationConfig
from wonderwall.simulations.social_media.prompts import (
    FacebookPromptBuilder,
    RedditPromptBuilder,
    ThreadsPromptBuilder,
    TikTokPromptBuilder,
    TwitterPromptBuilder,
)

# Lazy imports to avoid circular dependencies — the heavy classes are only
# needed at runtime, not at import time for the config objects.


def _get_platform_cls():
    from wonderwall.social_platform.platform import Platform
    return Platform


def _get_action_cls():
    from wonderwall.social_agent.agent_action import SocialAction
    return SocialAction


def _get_environment_cls():
    from wonderwall.social_agent.agent_environment import SocialEnvironment
    return SocialEnvironment


twitter_simulation = SimulationConfig(
    name="twitter",
    platform_cls=_get_platform_cls(),
    action_cls=_get_action_cls(),
    environment_cls=_get_environment_cls(),
    prompt_builder=TwitterPromptBuilder(),
    default_actions=[
        "create_post", "like_post", "repost", "follow",
        "do_nothing", "quote_post",
    ],
    platform_kwargs={
        "recsys_type": "twhin-bert",
        "refresh_rec_post_count": 5,
        "max_rec_post_len": 5,
        "following_post_count": 5,
    },
)

reddit_simulation = SimulationConfig(
    name="reddit",
    platform_cls=_get_platform_cls(),
    action_cls=_get_action_cls(),
    environment_cls=_get_environment_cls(),
    prompt_builder=RedditPromptBuilder(),
    default_actions=[
        "like_post", "dislike_post", "create_post", "create_comment",
        "like_comment", "dislike_comment", "search_posts", "search_user",
        "trend", "refresh", "do_nothing", "follow", "mute",
    ],
    platform_kwargs={
        "recsys_type": "reddit",
        "allow_self_rating": True,
        "show_score": True,
        "max_rec_post_len": 100,
        "refresh_rec_post_count": 5,
    },
)

facebook_simulation = SimulationConfig(
    name="facebook",
    platform_cls=_get_platform_cls(),
    action_cls=_get_action_cls(),
    environment_cls=_get_environment_cls(),
    prompt_builder=FacebookPromptBuilder(),
    default_actions=[
        "create_post", "create_comment", "like_post", "like_comment",
        "repost", "search_posts", "search_user", "trend", "refresh",
        "do_nothing", "follow", "mute", "report_post",
    ],
    # v1 scope (see _shared/MIROSHARK-VIETNAM-FIT-PLAN.md, Workstream C): a single
    # global feed, same shape as Reddit — there's no native community/subreddit
    # partitioning in this engine, so true per-group feeds are a bigger, separate
    # schema change. Reuses Reddit's recsys/time-model (real-world time transfer,
    # non-follow-graph feed composition) since that's a closer structural match
    # to a Groups feed than Twitter's follow-graph model. show_score=False and
    # allow_self_rating=False match real Facebook (plain like counts, no public
    # dislike/score, can't like your own post) — no DISLIKE_* action exists in
    # this platform's action set, so Reddit's dislike-handling code paths are
    # simply never exercised here.
    platform_kwargs={
        "recsys_type": "reddit",
        "allow_self_rating": False,
        "show_score": False,
        "max_rec_post_len": 20,
        "refresh_rec_post_count": 5,
    },
)

threads_simulation = SimulationConfig(
    name="threads",
    platform_cls=_get_platform_cls(),
    action_cls=_get_action_cls(),
    environment_cls=_get_environment_cls(),
    prompt_builder=ThreadsPromptBuilder(),
    default_actions=[
        "create_post", "create_comment", "like_post", "like_comment",
        "repost", "quote_post", "follow", "mute", "report_post",
        "do_nothing",
    ],
    # v1 scope (see _shared/MIROSHARK-VIETNAM-FIT-PLAN.md, Workstream D): closest
    # to the existing Twitter preset — same "twhin-bert" interest-based recsys and
    # non-Reddit time/feed-composition behavior (get_time_step(), following-graph
    # refresh), just a slightly more compact feed than Twitter's own. The one real
    # differentiator is CREATE_COMMENT/LIKE_COMMENT: Twitter's preset in this
    # engine has no comment mechanic at all (just posts/quotes), but Threads'
    # actual product identity is built around visible, threaded replies.
    platform_kwargs={
        "recsys_type": "twhin-bert",
        "refresh_rec_post_count": 5,
        "max_rec_post_len": 3,
        "following_post_count": 5,
    },
)

tiktok_simulation = SimulationConfig(
    name="tiktok",
    platform_cls=_get_platform_cls(),
    action_cls=_get_action_cls(),
    environment_cls=_get_environment_cls(),
    prompt_builder=TikTokPromptBuilder(),
    default_actions=[
        "create_post", "create_comment", "like_post", "like_comment",
        "repost", "follow", "mute", "report_post", "do_nothing",
    ],
    # v1 scope (see _shared/MIROSHARK-VIETNAM-FIT-PLAN.md, Workstream E):
    # "For You"-style feed — de-emphasize the follow graph, emphasize
    # engagement/virality. `following_post_count=0` turns off the
    # follow-graph augmentation platform.refresh() otherwise adds for
    # non-Reddit recsys types, so ranking comes entirely from twhin-bert
    # interest-similarity + recency. `enable_like_score=True` (a
    # platform.py constructor param that previously had no way to be
    # turned on — added alongside this preset) additionally weights
    # similarity to a user's own liked posts, matching TikTok's actual
    # engagement-signal-driven reputation more than any other preset here.
    # duet/stitch is a stretch goal, not v1 — no QUOTE_POST.
    platform_kwargs={
        "recsys_type": "twhin-bert",
        "enable_like_score": True,
        "refresh_rec_post_count": 8,
        "max_rec_post_len": 10,
        "following_post_count": 0,
    },
)

__all__ = [
    "twitter_simulation",
    "reddit_simulation",
    "facebook_simulation",
    "threads_simulation",
    "tiktok_simulation",
    "TwitterPromptBuilder",
    "RedditPromptBuilder",
    "FacebookPromptBuilder",
    "ThreadsPromptBuilder",
    "TikTokPromptBuilder",
]
