# =========== Copyright 2023 @ CAMEL-AI.org. All Rights Reserved. ===========
# Licensed under the Apache License, Version 2.0 (the “License”);
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an “AS IS” BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# =========== Copyright 2023 @ CAMEL-AI.org. All Rights Reserved. ===========
# flake8: noqa: E501
import warnings
from dataclasses import dataclass
from typing import Any

from camel.prompts import TextPrompt


@dataclass
class UserInfo:
    user_name: str | None = None
    name: str | None = None
    description: str | None = None
    profile: dict[str, Any] | None = None
    recsys_type: str = "twitter"
    is_controllable: bool = False

    def to_custom_system_message(self, user_info_template: TextPrompt) -> str:
        required_keys = user_info_template.key_words
        info_keys = set(self.profile.keys())
        missing = required_keys - info_keys
        extra = info_keys - required_keys
        if missing:
            raise ValueError(
                f"Missing required keys in UserInfo.profile: {missing}")
        if extra:
            warnings.warn(f"Extra keys not used in UserInfo.profile: {extra}")

        return user_info_template.format(**self.profile)

    def to_system_message(self) -> str:
        r"""Legacy, non-localized prompt fallback.

        Used only when a ``SocialAgent`` is constructed without a
        ``simulation=SimulationConfig`` (see ``wonderwall.social_agent.agent``
        — passing a ``SimulationConfig`` there routes through
        ``simulation.prompt_builder.build_system_prompt()`` instead, e.g.
        ``ThreadsPromptBuilder``/``FacebookPromptBuilder`` in
        ``wonderwall.simulations.social_media.prompts``, which are localized
        via ``app.prompts.get_prompt()``). This method intentionally no
        longer hardcodes a specific platform name/voice ("Twitter"/"Reddit")
        — that distinction now lives entirely in ``BasePromptBuilder``
        subclasses. Kept generic (rather than removed) because a handful of
        legacy, currently-uncalled agent-generator helpers in
        ``agents_generator.py`` (``generate_agents``, ``generate_agents_100w``,
        ``generate_controllable_agents``, ``gen_control_agents_with_data``,
        ``generate_reddit_agents``) still build ``SocialAgent`` without a
        ``simulation=`` kwarg and would otherwise crash if ever invoked.
        """
        name_string = ""
        description_string = ""
        description = name_string
        if self.name is not None:
            name_string = f"Your name is {self.name}."
            description = name_string
        if self.profile is not None and "other_info" in self.profile:
            other_info = self.profile["other_info"]
            if other_info.get("user_profile") is not None:
                user_profile = other_info["user_profile"]
                description_string = f"Your have profile: {user_profile}."
                description = f"{name_string}\n{description_string}"
                if all(k in other_info for k in
                       ("gender", "age", "mbti", "country")):
                    description += (
                        f"You are a {other_info['gender']}, "
                        f"{other_info['age']} years old, with an MBTI "
                        f"personality type of {other_info['mbti']} from "
                        f"{other_info['country']}.")

        system_content = f"""
# OBJECTIVE
You're a social media user, and I'll present you with some posts. After you see the posts, choose some actions from the following functions.

# SELF-DESCRIPTION
Your actions should be consistent with your self-description and personality.
{description}

# RESPONSE METHOD
Please perform actions by tool calling.
        """

        return system_content
